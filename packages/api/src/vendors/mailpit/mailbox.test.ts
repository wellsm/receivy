import { describe, expect, it, vi } from 'vitest';
import { createMailpitMailbox } from './mailbox';

const summary = {
  ID: 'msg-1',
  Subject: 'Seu código de acesso ao Receivy',
  From: { Name: 'Receivy', Address: 'login@receivy.local' },
  To: [{ Name: '', Address: 'ana@example.com' }],
  Snippet: 'Seu código de acesso é 123456.',
  Created: '2026-09-10T14:48:44.797Z'
};

describe('mailpit mailbox', () => {
  it('normalizes the search payload into flat addresses', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ messages: [summary] }));
    const mailbox = createMailpitMailbox('http://127.0.0.1:8025/', request);

    const [message] = await mailbox.search('to:ana@example.com', 5);

    expect(message).toEqual({
      id: 'msg-1',
      subject: 'Seu código de acesso ao Receivy',
      from: 'login@receivy.local',
      to: ['ana@example.com'],
      snippet: 'Seu código de acesso é 123456.',
      created: '2026-09-10T14:48:44.797Z'
    });

    const [url] = request.mock.calls[0] as [string];

    expect(url).toBe('http://127.0.0.1:8025/api/v1/search?query=to%3Aana%40example.com&limit=5');
  });

  it('reads the plain text body of a single message', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ Text: 'Seu código de acesso é 123456.' }));
    const mailbox = createMailpitMailbox('http://127.0.0.1:8025', request);

    expect(await mailbox.text('msg-1')).toBe('Seu código de acesso é 123456.');
    expect(request.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8025/api/v1/message/msg-1');
  });

  it('clears the whole mailbox with an empty id list', async () => {
    const request = vi.fn().mockResolvedValue(new Response('ok'));
    const mailbox = createMailpitMailbox('http://127.0.0.1:8025', request);

    await mailbox.clear();

    const [url, init] = request.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('http://127.0.0.1:8025/api/v1/messages');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(String(init.body))).toEqual({ ids: [] });
  });

  it('polls until a message arrives and gives up after the timeout', async () => {
    const request = vi
      .fn()
      .mockImplementationOnce(async () => Response.json({ messages: [] }))
      .mockImplementation(async () => Response.json({ messages: [summary] }));

    const mailbox = createMailpitMailbox('http://127.0.0.1:8025', request);
    const message = await mailbox.waitFor('to:ana@example.com', { interval: 1 });

    expect(message.id).toBe('msg-1');
    expect(request).toHaveBeenCalledTimes(2);

    const empty = createMailpitMailbox(
      'http://127.0.0.1:8025',
      vi.fn().mockImplementation(async () => Response.json({ messages: [] }))
    );

    await expect(empty.waitFor('to:ana@example.com', { interval: 1, timeout: 5 })).rejects.toThrow(/No Mailpit message matched/);
  });

  it('fails loudly when the mailbox API rejects the request', async () => {
    const mailbox = createMailpitMailbox('http://127.0.0.1:8025', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));

    await expect(mailbox.search('to:ana@example.com')).rejects.toThrow(/status 500/);
  });
});
