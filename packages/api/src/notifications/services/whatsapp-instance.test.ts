import { PlanTier, WhatsappInstanceState, WhatsappSender } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { createInstanceClient } from './whatsapp-instance';

const OWNER = 'd1111111-1111-4111-8111-111111111111';

/** Just enough of the database for the service: one instance row, one user sender, the event log. */
function fakeDb() {
  const state = {
    instance: null as Record<string, unknown> | null,
    sender: WhatsappSender.Receivy as WhatsappSender,
    events: [] as string[],
    lastEventPayload: undefined as Record<string, unknown> | undefined
  };
  const db = {
    whatsapp_instances: {
      findOne: async ({ where }: { where: Record<string, unknown> }) => {
        const row = state.instance;

        if (!row) {
          return undefined;
        }

        const byOwner = where['owner_id'] !== undefined && row['owner_id'] === where['owner_id'];
        const byName = where['name'] !== undefined && row['name'] === where['name'];

        return byOwner || byName ? row : undefined;
      },
      insertOne: async ({ data }: { data: Record<string, unknown> }) => {
        state.instance = { ...data, owner_id: (data['owner'] as { id: string }).id };

        return state.instance;
      },
      updateOne: async ({ data }: { data: Record<string, unknown> }) => {
        state.instance = { ...state.instance, ...data };
      },
      deleteOne: async () => {
        state.instance = null;
      }
    },
    users: {
      findOne: async () => ({ whatsapp_sender: state.sender, email: 'owner@example.com' }),
      updateOne: async ({ data }: { data: { whatsapp_sender: WhatsappSender } }) => {
        state.sender = data.whatsapp_sender;
      }
    },
    events: {
      insertOne: async ({ data }: { data: { type: string; payload?: Record<string, unknown> } }) => {
        state.events.push(data.type);
        state.lastEventPayload = data.payload;
      }
    },
    // Ana (u1) is filed with a phone; Bruno (u2) has only his own, which predates the ninth digit.
    contacts: {
      findMany: async () => ({
        records: [
          { user_id: 'u1', phone: '(11) 98888-7777', user: { phone: null } },
          { user_id: 'u2', phone: null, user: { phone: '+55 21 97777-6666' } }
        ]
      })
    },
    // One active device, so the disconnect warning has somewhere to land.
    device_tokens: { findMany: async () => ({ records: [{ id: 'device-1', token: 'ExpoPushToken[fixture]' }] }) },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
  };

  return { db: db as never, state };
}

const basic = { get: async () => ({ plan: PlanTier.Basic }) as never };
const free = { get: async () => ({ plan: PlanTier.Free }) as never };
const variables = { EVOLUTION_API_URL: 'http://evo', EVOLUTION_API_KEY: 'global', PUBLIC_API_ORIGIN: 'https://api.receivy.example', PUBLIC_WEB_ORIGIN: 'https://receivy.example' };
const created = () => Response.json({ instance: { instanceName: `rcv_${OWNER}` }, hash: 'ignored', qrcode: { base64: 'data:image/png;base64,QR' } }, { status: 201 });

describe('WhatsApp instance service', () => {
  it('creates the instance on Evolution with a per-owner token and webhook, and switches the sender', async () => {
    const { db, state } = fakeDb();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(created());
    const client = createInstanceClient({ db, plans: basic, variables, request });

    expect(await client.create(OWNER, { riskAccepted: true })).toEqual({ state: WhatsappInstanceState.Pending, phone: null, qr: 'data:image/png;base64,QR', pairingCode: null, connectedAt: null, disconnectedAt: null });
    expect(state.sender).toBe(WhatsappSender.Own);
    expect(state.events).toEqual(['whatsapp_instance.created']);

    expect(String(request.mock.calls[0]![0])).toBe(`http://evo/instance/delete/rcv_${OWNER}`);
    expect(request.mock.calls[0]![1]?.method).toBe('DELETE');

    const [url, init] = request.mock.calls[1]!;
    const body = JSON.parse(String(init?.body));

    expect(String(url)).toBe('http://evo/instance/create');
    expect(new Headers(init?.headers).get('apikey')).toBe('global');
    expect(body.instanceName).toBe(`rcv_${OWNER}`);
    expect(body.integration).toBe('WHATSAPP-BAILEYS');
    expect(body.qrcode).toBe(true);
    expect(body.token).toBe(state.instance?.['token']);
    expect(String(body.token)).toHaveLength(64);
    expect(body.webhook.url).toBe('https://api.receivy.example/webhooks/whatsapp/evolution');
    expect(body.webhook.headers.authorization).toBe(state.instance?.['webhook_secret']);
    expect(body.webhook.events).toEqual(['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE']);
  });

  it('refuses the free plan before calling Evolution and answers 503 when Evolution is off', async () => {
    const { db } = fakeDb();
    const request = vi.fn<typeof fetch>();

    await expect(createInstanceClient({ db, plans: free, variables, request }).create(OWNER, { riskAccepted: true })).rejects.toMatchObject({ status: 402 });
    await expect(createInstanceClient({ db, plans: basic, variables: { ...variables, EVOLUTION_API_KEY: 'disabled' }, request }).create(OWNER, { riskAccepted: true })).rejects.toMatchObject({ status: 503 });
    expect(request).not.toHaveBeenCalled();
  });

  it('returns the existing row on a second create, and never the token or the secret', async () => {
    const { db, state } = fakeDb();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(created());
    const client = createInstanceClient({ db, plans: basic, variables, request });

    await client.create(OWNER, { riskAccepted: true });

    const again = await client.create(OWNER, { riskAccepted: true });

    expect(request).toHaveBeenCalledTimes(2);
    expect(Object.keys(again).sort()).toEqual(['connectedAt', 'disconnectedAt', 'pairingCode', 'phone', 'qr', 'state']);
    expect(state.events).toEqual(['whatsapp_instance.created']);
  });

  it('rolls the row and the sender back and answers 503 when Evolution refuses the create', async () => {
    const { db, state } = fakeDb();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(new Response(null, { status: 500 }));
    const client = createInstanceClient({ db, plans: basic, variables, request });

    await expect(client.create(OWNER, { riskAccepted: true })).rejects.toMatchObject({ status: 503 });
    expect(state.instance).toBeNull();
    expect(state.sender).toBe(WhatsappSender.Receivy);
    expect(state.events).toEqual([]);
  });

  it('opens and closes on connection updates, clearing the qr and warning the owner once on close', async () => {
    const { db, state } = fakeDb();
    const pushes: string[] = [];
    const emails: { to: string; subject: string }[] = [];
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(created());
    const transport = {
      push: async (input: { title: string }) => {
        pushes.push(input.title);

        return { status: 'accepted' as const, id: 't' };
      },
      email: async (input: { to: string; subject: string }) => {
        emails.push({ to: input.to, subject: input.subject });

        return { status: 'accepted' as const, id: 'e' };
      }
    } as never;
    const client = createInstanceClient({ db, plans: basic, variables, request, transport });

    await client.create(OWNER, { riskAccepted: true });
    await client.applyConnection(`rcv_${OWNER}`, 'open', '5511988887777');

    expect(state.instance).toMatchObject({ state: WhatsappInstanceState.Open, phone: '5511988887777' });
    expect(state.instance?.['qr']).toBeNull();

    await client.applyConnection(`rcv_${OWNER}`, 'close');
    await client.applyConnection(`rcv_${OWNER}`, 'close');
    await client.applyConnection('rcv_unknown', 'close');

    expect(state.instance).toMatchObject({ state: WhatsappInstanceState.Closed });
    expect(state.events).toEqual(['whatsapp_instance.created', 'whatsapp_instance.opened', 'whatsapp_instance.closed']);
    expect(pushes).toEqual(['Seu WhatsApp desconectou']);
    expect(emails).toEqual([{ to: 'owner@example.com', subject: 'Seu WhatsApp desconectou' }]);
  });

  it('removes the instance on Evolution, tolerating a 404, and puts the sender back', async () => {
    const { db, state } = fakeDb();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 })) // pre-create cleanup: no orphan to remove
      .mockResolvedValueOnce(created())
      .mockResolvedValueOnce(new Response(null, { status: 404 })) // logout tolerates a 404
      .mockResolvedValueOnce(Response.json({ status: 'SUCCESS' }));
    const client = createInstanceClient({ db, plans: basic, variables, request });

    await client.create(OWNER, { riskAccepted: true });
    await client.remove(OWNER);

    expect(state.instance).toBeNull();
    expect(state.sender).toBe(WhatsappSender.Receivy);
    expect(String(request.mock.calls[2]![0])).toBe(`http://evo/instance/logout/rcv_${OWNER}`);
    expect(String(request.mock.calls[3]![0])).toBe(`http://evo/instance/delete/rcv_${OWNER}`);
    expect(await client.get(OWNER)).toBeNull();
  });

  it('refuses to create without the risk acceptance and with a phone that is not a number', async () => {
    const { db } = fakeDb();
    const request = vi.fn<typeof fetch>();
    const client = createInstanceClient({ db, plans: basic, variables, request });

    await expect(client.create(OWNER, { riskAccepted: false })).rejects.toMatchObject({ status: 400 });
    await expect(client.create(OWNER, { riskAccepted: true, phone: '12' })).rejects.toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
  });

  it('asks Evolution for a pairing code when a phone is given and records the acceptance', async () => {
    const { db, state } = fakeDb();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(created())
      .mockResolvedValueOnce(Response.json({ pairingCode: 'ABCD-1234', code: 'x', base64: 'data:image/png;base64,QR2' }));
    const client = createInstanceClient({ db, plans: basic, variables, request });

    const view = await client.create(OWNER, { riskAccepted: true, phone: '(11) 98888-7777' });

    expect(view).toMatchObject({ state: WhatsappInstanceState.Pending, phone: '5511988887777', pairingCode: 'ABCD-1234' });
    expect(String(request.mock.calls[2]![0])).toBe(`http://evo/instance/connect/rcv_${OWNER}?number=5511988887777`);
    expect(JSON.parse(String(request.mock.calls[1]![1]?.body)).number).toBe('5511988887777');
    expect(state.events).toEqual(['whatsapp_instance.created']);
    expect(state.lastEventPayload).toMatchObject({ pairing: 'code' });
    expect(typeof state.lastEventPayload?.['riskAcceptedAt']).toBe('string');
  });

  it('keeps the create body QR when a phone is given but the connect call fails', async () => {
    const { db, state } = fakeDb();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(created())
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const client = createInstanceClient({ db, plans: basic, variables, request });

    const view = await client.create(OWNER, { riskAccepted: true, phone: '(11) 98888-7777' });

    expect(view).toMatchObject({ qr: 'data:image/png;base64,QR', pairingCode: null });
    expect(state.instance?.['qr']).toBe('data:image/png;base64,QR');
    expect(state.instance?.['pairing_code']).toBeFalsy();
  });

  it('refreshes the qr and the code on demand while pending, and keeps them otherwise', async () => {
    const { db, state } = fakeDb();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(created())
      .mockResolvedValueOnce(Response.json({ base64: 'data:image/png;base64,QR9' }));
    const client = createInstanceClient({ db, plans: basic, variables, request });

    await client.create(OWNER, { riskAccepted: true });

    expect((await client.get(OWNER))?.qr).toBe('data:image/png;base64,QR');
    expect(request).toHaveBeenCalledTimes(2);
    expect((await client.get(OWNER, true))?.qr).toBe('data:image/png;base64,QR9');
    expect(request).toHaveBeenCalledTimes(3);
    expect(state.instance?.['qr']).toBe('data:image/png;base64,QR9');
    expect(state.instance?.['pairing_code']).toBeFalsy();
  });

  it('mirrors the stored pairing on refresh: a code-only refresh clears the now-expired qr', async () => {
    const { db } = fakeDb();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(created())
      .mockResolvedValueOnce(Response.json({ pairingCode: 'NEW-CODE' }));
    const client = createInstanceClient({ db, plans: basic, variables, request });

    await client.create(OWNER, { riskAccepted: true });

    const view = await client.get(OWNER, true);

    expect(view?.qr).toBeNull();
    expect(view?.pairingCode).toBe('NEW-CODE');
  });

  it('switches the sender freely and refuses own without an instance', async () => {
    const { db, state } = fakeDb();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(created());
    const client = createInstanceClient({ db, plans: basic, variables, request });

    await expect(client.setSender(OWNER, WhatsappSender.Own)).rejects.toMatchObject({ status: 409 });
    await client.create(OWNER, { riskAccepted: true });
    expect(await client.setSender(OWNER, WhatsappSender.Receivy)).toBe(WhatsappSender.Receivy);
    expect(state.sender).toBe(WhatsappSender.Receivy);
    expect(await client.setSender(OWNER, WhatsappSender.Own)).toBe(WhatsappSender.Own);
    expect(state.events).toEqual(['whatsapp_instance.created', 'whatsapp_sender.changed', 'whatsapp_sender.changed']);
  });

  it('refuses the own number on the Free plan before looking at the instance, without writing', async () => {
    const { db, state } = fakeDb();

    state.instance = { id: 'instance-1', owner_id: OWNER, name: `rcv_${OWNER}`, state: WhatsappInstanceState.Open };

    const client = createInstanceClient({ db, plans: free, variables, request: vi.fn<typeof fetch>() });

    await expect(client.setSender(OWNER, WhatsappSender.Own)).rejects.toMatchObject({ status: 402 });
    expect(state.sender).toBe(WhatsappSender.Receivy);
    expect(state.events).toEqual([]);
  });

  it('lists the groups of the connected number with its own token, the ones holding every participant first', async () => {
    const { db, state } = fakeDb();

    state.instance = { id: 'i1', owner_id: OWNER, name: `rcv_${OWNER}`, token: 'instance-token', state: WhatsappInstanceState.Open };

    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json([
        { id: '120363000000000001@g.us', subject: 'Zeladoria', size: 40, participants: [{ id: '5511988887777@s.whatsapp.net' }] },
        { id: '120363000000000002@g.us', subject: 'Creche Pet', size: 3, participants: [{ id: '5511988887777@s.whatsapp.net' }, { id: '552177776666@s.whatsapp.net' }, { id: '123@lid' }] },
        { id: '5511999999999@s.whatsapp.net', subject: 'not a group' }
      ])
    );
    const client = createInstanceClient({ db, plans: basic, variables, request });

    expect(await client.groups(OWNER, ['u1', 'u2'])).toEqual([
      { jid: '120363000000000002@g.us', name: 'Creche Pet', size: 3, suggested: true },
      { jid: '120363000000000001@g.us', name: 'Zeladoria', size: 40, suggested: false }
    ]);

    const [url, init] = request.mock.calls[0]!;

    expect(url).toBe(`http://evo/group/fetchAllGroups/rcv_${OWNER}?getParticipants=true`);
    expect((init?.headers as Record<string, string>).apikey).toBe('instance-token');
  });

  it('refuses to list groups without an open instance and answers 503 when Evolution fails', async () => {
    const { db, state } = fakeDb();
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 }));
    const client = createInstanceClient({ db, plans: basic, variables, request });

    await expect(client.groups(OWNER, [])).rejects.toMatchObject({ context: { code: 'WHATSAPP_INSTANCE_REQUIRED' } });

    state.instance = { id: 'i1', owner_id: OWNER, name: `rcv_${OWNER}`, token: 't', state: WhatsappInstanceState.Closed };

    await expect(client.groups(OWNER, [])).rejects.toMatchObject({ context: { code: 'WHATSAPP_INSTANCE_REQUIRED' } });
    expect(request).not.toHaveBeenCalled();

    state.instance = { ...state.instance, state: WhatsappInstanceState.Open };

    await expect(client.groups(OWNER, [])).rejects.toMatchObject({ context: { code: 'WHATSAPP_INSTANCE_UNAVAILABLE' } });
  });
});
