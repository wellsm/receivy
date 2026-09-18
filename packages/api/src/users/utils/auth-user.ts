import type { AuthUser } from '@receivy/common';
import { avatarRef } from './avatar';

/** The account columns an authenticated session reads back as `AuthUser`. */
export type AuthUserRow = {
  id: string;
  email?: string;
  name?: string;
  phone?: string;
  avatar_url?: string;
  avatar_updated_at?: string;
  status: AuthUser['status'];
  locale: 'pt-BR';
  timezone: string;
  country: 'BR';
  currency: 'BRL';
};

export function toAuthUser(row: AuthUserRow): AuthUser {
  // Only a placeholder typed by an owner lacks an address, and a placeholder never authenticates.
  if (!row.email) {
    throw new Error('Authenticated user without e-mail.');
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    phone: row.phone ?? null,
    avatar: avatarRef(row.id, row.avatar_updated_at),
    status: row.status,
    locale: row.locale,
    timezone: row.timezone,
    country: row.country,
    currency: row.currency
  };
}
