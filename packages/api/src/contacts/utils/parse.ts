import { HttpBadRequestError } from '@ez4/gateway';
import { type ContactInput, normalizeContact } from '@receivy/common';
import { type ContactPaymentMethodBody, contactPaymentMethodInput } from './body';

export type ContactBody = {
  name: string;
  nickname?: string;
  email?: string;
  phone?: string;
  whatsappConsent?: boolean;
  paymentMethod?: ContactPaymentMethodBody;
};

export function parseContactInput(input: ContactBody): ContactInput {
  try {
    return normalizeContact({
      name: input.name,
      nickname: input.nickname,
      email: input.email,
      phone: input.phone,
      whatsappConsent: input.whatsappConsent,
      ...(input.paymentMethod ? { paymentMethod: contactPaymentMethodInput(input.paymentMethod) } : {})
    });
  } catch (error) {
    throw new HttpBadRequestError(error instanceof Error ? error.message : 'Contato inválido.');
  }
}
