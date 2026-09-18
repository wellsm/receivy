import { type UserAvatar, UserStatus } from '@receivy/common';
import { avatarRef } from '../../users/utils/avatar';

/** The columns of `users` a person is shown from, on a contact, a charge or a billing. */
export type PersonRow = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  status: UserStatus;
  avatar_updated_at?: string | Date | null;
};

/** A person as the app shows them: a removed account keeps its placeholder name and nothing else. */
export type Person = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: UserStatus;
  avatar: UserAvatar | null;
};

/** The person behind a removed account keeps a placeholder name so history still reads. */
export function personName(user: Pick<PersonRow, 'name' | 'status' | 'email'>): string {
  if (user.status === UserStatus.Removed) {
    return 'Conta excluída';
  }

  return user.name?.trim() || user.email || 'Sem nome';
}

export function personOf(user: PersonRow | null | undefined): Person | null {
  if (!user) {
    return null;
  }

  const removed = user.status === UserStatus.Removed;

  return {
    id: user.id,
    name: personName(user),
    email: removed ? null : (user.email ?? null),
    phone: removed ? null : (user.phone ?? null),
    status: user.status,
    avatar: removed ? null : avatarRef(user.id, user.avatar_updated_at)
  };
}
