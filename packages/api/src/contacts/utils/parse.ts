import { HttpBadRequestError } from '@ez4/gateway';
import { type ContactInput, normalizeContact } from '@receivy/common';

export function parseContactInput(input: ContactInput): ContactInput {
  try {
    return normalizeContact(input);
  } catch (error) {
    throw new HttpBadRequestError(error instanceof Error ? error.message : 'Contato inválido.');
  }
}
