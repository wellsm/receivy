import { normalizeEmail } from '../auth/auth';

/** A person as one agenda knows them: the account is the identity, the nickname is the owner's. */
export type UserStatus = 'pending' | 'active' | 'removed';

/**
 * What an owner types to add someone. The e-mail is the identity when present; without one the person only
 * receives charges through shared links until the owner fills it in or links a guest who joined by invite.
 * A contact for an account that already exists (`active`) only accepts the nickname; name and e-mail belong
 * to that person.
 */
export type ContactInput = { name: string; nickname?: string; email?: string };

export type Contact = {
  /** The agenda entry (contacts table). */
  id: string;
  /** The person behind it (users table); the same across every agenda. */
  userId: string;
  name: string;
  nickname: string | null;
  /** What every list, card and feed shows: the nickname when there is one, the person's name otherwise. */
  displayName: string;
  /** Empty when the person has no e-mail yet: the contact is reachable by shared link only. */
  email: string;
  /** Filled by the person themself at onboarding; never by the owner. */
  phone: string | null;
  /** `pending` until the person signs in; then name and e-mail stop being editable from any agenda. */
  status: UserStatus;
  archivedAt: string | null;
  createdAt: string;
  lastBilledAt: string | null;
  /** Charges still `pending` between the owner and this person; drives the agenda badge. */
  activeCharges: number;
};

export type ContactsPage = { contacts: Contact[]; nextCursor: string | null };

export function normalizeContact(input: ContactInput): ContactInput {
  if (
    typeof input?.name !== 'string' ||
    (input.nickname !== undefined && typeof input.nickname !== 'string') ||
    (input.email !== undefined && typeof input.email !== 'string')
  )
    throw new Error('Dados de contato inválidos.');
  const name = input.name.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120) throw new Error('Informe um nome com até 120 caracteres.');
  // An empty nickname is how the clients clear it, so it normalizes to `undefined` instead of failing.
  const nickname = (input.nickname ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
  if (nickname.length > 60) throw new RangeError('Informe um apelido com até 60 caracteres.');
  // An empty e-mail is how the clients leave it out; only a filled one has to look like an address.
  const email = normalizeEmail(input.email ?? '');
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Informe um e-mail válido.');
  return { name, ...(nickname ? { nickname } : {}), ...(email ? { email } : {}) };
}
