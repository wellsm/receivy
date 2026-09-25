import { WhatsappMessageStatus } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import { evolutionInstanceOf, parseEvolutionEvent, parseMetaStatuses } from './webhook';

describe('parseMetaStatuses', () => {
  it('keeps the four delivery statuses in order and describes a failure by its first error', () => {
    const payload = {
      entry: [
        {
          changes: [
            { field: 'messages', value: { messages: [{ id: 'incoming' }] } },
            {
              field: 'messages',
              value: {
                statuses: [
                  { id: 'wamid.1', status: 'sent' },
                  { id: 'wamid.1', status: 'delivered' },
                  { id: 'wamid.2', status: 'failed', errors: [{ code: 131026, title: 'Undeliverable' }] },
                  { id: 'wamid.3', status: 'deleted' },
                  { status: 'read' }
                ]
              }
            },
            { field: 'account_update', value: {} }
          ]
        }
      ]
    };

    expect(parseMetaStatuses(payload)).toEqual([
      { providerMessageId: 'wamid.1', status: WhatsappMessageStatus.Sent },
      { providerMessageId: 'wamid.1', status: WhatsappMessageStatus.Delivered },
      { providerMessageId: 'wamid.2', status: WhatsappMessageStatus.Failed, error: '131026: Undeliverable' }
    ]);
    expect(parseMetaStatuses(null)).toEqual([]);
    expect(parseMetaStatuses({ entry: 'nope' })).toEqual([]);
  });
});

describe('parseEvolutionEvent', () => {
  it('reads connection, status and qr events and ignores the rest', () => {
    expect(parseEvolutionEvent({ event: 'connection.update', instance: 'rcv_a', data: { state: 'open', wuid: '5511999999999@s.whatsapp.net' } })).toEqual({
      kind: 'connection',
      instance: 'rcv_a',
      state: 'open',
      phone: '5511999999999'
    });
    expect(parseEvolutionEvent({ event: 'connection.update', instance: 'rcv_a', data: { state: 'close' } })).toEqual({ kind: 'connection', instance: 'rcv_a', state: 'close' });
    expect(parseEvolutionEvent({ event: 'messages.update', instance: 'rcv_a', data: { keyId: 'BAE5', status: 'DELIVERY_ACK' } })).toEqual({
      kind: 'status',
      instance: 'rcv_a',
      providerMessageId: 'BAE5',
      status: WhatsappMessageStatus.Delivered
    });
    expect(parseEvolutionEvent({ event: 'messages.update', instance: 'rcv_a', data: { key: { id: 'BAE6' }, status: 'READ' } })).toMatchObject({ providerMessageId: 'BAE6', status: WhatsappMessageStatus.Read });
    expect(parseEvolutionEvent({ event: 'messages.update', instance: 'rcv_a', data: { keyId: 'BAE7', status: 'ERROR' } })).toMatchObject({ status: WhatsappMessageStatus.Failed });
    expect(parseEvolutionEvent({ event: 'messages.update', instance: 'rcv_a', data: { keyId: 'BAE8', status: 'PENDING' } })).toBeNull();
    expect(parseEvolutionEvent({ event: 'qrcode.updated', instance: 'rcv_a', data: { qrcode: { base64: 'data:image/png;base64,AAA' } } })).toEqual({ kind: 'qr', instance: 'rcv_a', qr: 'data:image/png;base64,AAA' });
    expect(parseEvolutionEvent({ event: 'contacts.upsert', instance: 'rcv_a', data: {} })).toBeNull();
    expect(parseEvolutionEvent('junk')).toBeNull();
    expect(parseEvolutionEvent({ event: 'connection.update', instance: 'rcv_a', data: { state: 'foo' } })).toBeNull();
  });

  it('names the instance before the event is trusted', () => {
    expect(evolutionInstanceOf({ event: 'x', instance: 'rcv_a' })).toBe('rcv_a');
    expect(evolutionInstanceOf({ event: 'x' })).toBeNull();
  });
});
