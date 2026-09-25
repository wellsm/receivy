import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyEvolutionSecret, verifyMetaSignature } from './signature';

const body = '{"object":"whatsapp_business_account","entry":[]}';
const sign = (secret: string, raw: string) => `sha256=${createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`;

describe('verifyMetaSignature', () => {
  it('accepts the HMAC of the raw body and refuses everything else', () => {
    expect(verifyMetaSignature('secret', body, sign('secret', body))).toBe(true);
    expect(verifyMetaSignature('secret', `${body} `, sign('secret', body))).toBe(false);
    expect(verifyMetaSignature('other', body, sign('secret', body))).toBe(false);
    expect(verifyMetaSignature('secret', body, undefined)).toBe(false);
    expect(verifyMetaSignature('secret', body, 'sha256=zz')).toBe(false);
    expect(verifyMetaSignature('', body, sign('', body))).toBe(false);
    expect(verifyMetaSignature('disabled', body, sign('disabled', body))).toBe(false);
  });
});

describe('verifyEvolutionSecret', () => {
  it('compares the header with the instance secret in constant time and refuses empties', () => {
    expect(verifyEvolutionSecret('abc', 'abc')).toBe(true);
    expect(verifyEvolutionSecret('abc', 'abd')).toBe(false);
    expect(verifyEvolutionSecret('abc', undefined)).toBe(false);
    expect(verifyEvolutionSecret('', '')).toBe(false);
  });
});
