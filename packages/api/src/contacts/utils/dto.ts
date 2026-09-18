import { type Contact, UserStatus } from '@receivy/common';
import { avatarRef } from '../../users/utils/avatar';
import { type PersonRow, personName } from './person';

export type ContactRow = {
  id: string;
  owner_id: string;
  user_id: string;
  nickname?: string | null;
  archived_at?: string | null;
  created_at: string;
  user: PersonRow;
};

/** An agenda entry with what the card shows beyond the row: the person, their last billing and their open charges. */
export function contactOf(row: ContactRow, lastBilledAt: string | null, activeCharges: number): Contact {
  const { user } = row;
  const name = personName(user);
  const removed = user.status === UserStatus.Removed;

  return {
    id: row.id,
    userId: row.user_id,
    name,
    nickname: row.nickname ?? null,
    displayName: row.nickname || name,
    avatar: removed ? null : avatarRef(user.id, user.avatar_updated_at),
    email: removed ? '' : (user.email ?? ''),
    phone: user.phone ?? null,
    status: user.status,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    lastBilledAt,
    activeCharges
  };
}
