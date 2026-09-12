import { normalizeEmail } from '../auth/auth';

export type PersonInput = { name: string; nickname?: string; email?: string; phone?: string };
export type Person = {
  id: string;
  name: string;
  nickname: string | null;
  /** What every list, card and feed shows: the nickname when there is one, the full name otherwise. */
  displayName: string;
  email: string | null;
  phone: string | null;
  archivedAt: string | null;
  createdAt: string;
  hasAccount: boolean;
  lastBilledAt: string | null;
  /** Charges still `pending` for this contact; drives the agenda badge. */
  activeCharges: number;
};
export type PeoplePage = { people: Person[]; nextCursor: string | null };

export function normalizePerson(input: PersonInput): PersonInput {
  if (
    typeof input?.name !== 'string' ||
    (input.nickname !== undefined && typeof input.nickname !== 'string') ||
    (input.email !== undefined && typeof input.email !== 'string') ||
    (input.phone !== undefined && typeof input.phone !== 'string')
  )
    throw new Error('Dados de contato inválidos.');
  const name = input.name.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120) throw new Error('Informe um nome com até 120 caracteres.');
  // An empty nickname is how the clients clear it, so it normalizes to `undefined` instead of failing.
  const nickname = (input.nickname ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
  if (nickname.length > 60) throw new RangeError('Informe um apelido com até 60 caracteres.');
  const email = normalizeEmail(input.email ?? '');
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Informe um e-mail válido.');
  const raw = (input.phone ?? '').trim();
  let phone: string | undefined;
  if (raw) {
    if (!/^[+\d\s().-]+$/.test(raw) || raw.length > 40) throw new Error('Informe um telefone válido com DDD.');
    const digits = raw.replace(/\D/g, '');
    if (raw.startsWith('+')) {
      if (!/^\+[1-9]\d{7,14}$/.test('+' + digits)) throw new Error('Informe um telefone internacional válido.');
      phone = '+' + digits;
    } else {
      if (!/^[1-9]\d{9,10}$/.test(digits)) throw new Error('Informe um telefone válido com DDD.');
      phone = '+55' + digits;
    }
  }
  return { name, ...(nickname ? { nickname } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
}
