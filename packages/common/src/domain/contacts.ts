import { normalizeEmail } from '../auth/auth';
import type { UserAvatar } from './avatar';
import type { PixMethodInput } from './contracts';
import { normalizePhone } from './phone';

/** Whose phone won: the person's own, filed once they signed in, or the owner's typed guess. */
export const enum PhoneSource {
  Person = 'person',
  Owner = 'owner'
}

/** A person as one agenda knows them: the account is the identity, the nickname is the owner's. */
export const enum UserStatus {
  Pending = 'pending',
  Active = 'active',
  Removed = 'removed'
}

/**
 * What an owner types to add someone. The e-mail is the identity when present; without one the person only
 * receives charges through shared links until the owner fills it in or links a guest who joined by invite.
 * A contact for an account that already exists (`active`) only accepts the nickname; name and e-mail belong
 * to that person.
 */

/** What the contact form types for how the owner pays this person; a contact key is always Pix. */
export type ContactPaymentMethodInput = Omit<PixMethodInput, 'contactId'>;

export type ContactInput = {
  name: string;
  nickname?: string;
  email?: string;
  /** What the owner types for this person; the person's own phone, once filed, always wins. */
  phone?: string;
  /** Whether this person agreed to hear from the owner over WhatsApp. */
  whatsappConsent?: boolean;
  /** Block 9.1: filed under this contact and made its default; the billing form only picks among them. */
  paymentMethod?: ContactPaymentMethodInput;
};

export type Contact = {
  /** The agenda entry (contacts table). */
  id: string;
  /** The person behind it (users table); the same across every agenda. */
  userId: string;
  name: string;
  nickname: string | null;
  /** What every list, card and feed shows: the nickname when there is one, the person's name otherwise. */
  displayName: string;
  avatar?: UserAvatar | null;
  /** Empty when the person has no e-mail yet: the contact is reachable by shared link only. */
  email: string;
  /** The effective phone: the person's own once filed, the owner's typed guess otherwise. */
  phone: string | null;
  /** Which one `phone` is; `null` when neither is filed. */
  phoneSource: PhoneSource | null;
  /** When this person agreed to hear from the owner over WhatsApp; `null` when never given or withdrawn. */
  whatsappConsentAt: string | null;
  /** `pending` until the person signs in; then name and e-mail stop being editable from any agenda. */
  status: UserStatus;
  archivedAt: string | null;
  createdAt: string;
  lastBilledAt: string | null;
  /** Charges still `pending` between the owner and this person; drives the agenda badge. */
  activeCharges: number;
};

export type ContactsPage = { contacts: Contact[]; nextCursor: string | null };

/** A contact can actually receive a notice once it has an e-mail or a phone; a placeholder with neither is reachable by shared link only. */
export function canNotifyContact(contact: Pick<Contact, 'email' | 'phone'>): boolean {
  return Boolean(contact.email.trim()) || Boolean(contact.phone?.trim());
}

export function normalizeContact(input: ContactInput): ContactInput {
  if (
    typeof input?.name !== 'string' ||
    (input.nickname !== undefined && typeof input.nickname !== 'string') ||
    (input.email !== undefined && typeof input.email !== 'string')
  ) {
    throw new Error('Dados de contato inválidos.');
  }

  const name = input.name.normalize('NFC').trim().replace(/\s+/g, ' ');

  if (!name || name.length > 120) {
    throw new Error('Informe um nome com até 120 caracteres.');
  }

  // An empty nickname is how the clients clear it, so it normalizes to `undefined` instead of failing.
  const nickname = (input.nickname ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');

  if (nickname.length > 60) {
    throw new RangeError('Informe um apelido com até 60 caracteres.');
  }

  // An empty e-mail is how the clients leave it out; only a filled one has to look like an address.
  const email = normalizeEmail(input.email ?? '');

  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error('Informe um e-mail válido.');
  }

  const phone = normalizePhone(input.phone);

  if (phone === false) {
    throw new Error('Informe um telefone válido.');
  }

  return {
    name,
    ...(nickname ? { nickname } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(input.whatsappConsent !== undefined ? { whatsappConsent: Boolean(input.whatsappConsent) } : {}),
    ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {})
  };
}
