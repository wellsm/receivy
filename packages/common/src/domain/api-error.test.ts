import { describe, expect, it } from 'vitest';
import { apiErrorMessage } from './api-error';

describe('apiErrorMessage', () => {
  it('keeps the API copy on a 402', () => {
    expect(apiErrorMessage(402, { message: 'Links de pagamento fazem parte do plano Básico.' }, 'fallback')).toBe('Links de pagamento fazem parte do plano Básico.');
    expect(apiErrorMessage(402, null, 'fallback')).toBe('Esse recurso faz parte do plano Básico.');
  });
});
