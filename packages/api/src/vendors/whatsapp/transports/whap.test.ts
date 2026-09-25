import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { NoticeTemplate } from '../../../notifications/services/render';
import { createWhatsappClient } from '../compose';
import { buildChargeTemplate } from '../templates';

const input = { name: 'Marina', creditor: 'Wellington', cents: 62000, dueDate: '2029-01-04', description: 'Aluguel', token: 'tok123' };

const FIXTURES: [string, NoticeTemplate][] = [
  ['receivy-charge-initial', NoticeTemplate.Initial],
  ['receivy-charge-reminder', NoticeTemplate.Reminder],
  ['receivy-charge-manual', NoticeTemplate.Manual]
];

describe('whap transport', () => {
  for (const [file, template] of FIXTURES) {
    it(`sends ${file} as one named body whap understands, without changing the Meta payload`, async () => {
      const payload = buildChargeTemplate({ ...input, template });
      const before = structuredClone(payload);
      const fixture = JSON.parse(await readFile(new URL(`../../../../whap/templates/${file}.json`, import.meta.url), 'utf8'));
      const request = vi.fn<typeof fetch>(async (url, init) => {
        expect(String(url)).toBe('http://127.0.0.1:3011/v21.0/000000000000000/messages');

        const body = JSON.parse(String(init?.body));

        expect(body.template.name).toBe(fixture.name);
        expect(body.template.components).toHaveLength(1);
        expect(body.template.components[0].type).toBe('body');

        const names = body.template.components[0].parameters.map((parameter: { parameter_name: string }) => parameter.parameter_name);

        for (const name of Object.keys(fixture.variables)) {
          expect(names).toContain(name);
        }

        return Response.json({ messages: [{ id: 'wamid.local' }] });
      });
      const client = createWhatsappClient({ APP_STAGE: 'dev' }, request);

      expect(await client.send('whap', { to: '5511999999999', key: 'k', text: 't', template: payload })).toEqual({ status: 'accepted', id: 'wamid.local' });
      expect(payload).toEqual(before);
    });
  }

  it('throws before any request in production', async () => {
    const request = vi.fn<typeof fetch>();
    const client = createWhatsappClient({ APP_STAGE: 'prd' }, request);

    await expect(client.send('whap', { to: '1', key: 'k', text: 't', template: buildChargeTemplate({ ...input, template: NoticeTemplate.Manual }) })).rejects.toThrow(
      "WhatsApp transport 'whap' is forbidden when APP_STAGE=prd."
    );
    expect(request).not.toHaveBeenCalled();
  });
});
