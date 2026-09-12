import type { DbClient } from '../../database';

/** Acquire at transaction entry, before row/FK locks. Never upgrade shared to exclusive.
 * Stable PostgreSQL advisory namespace 0x52454356 (RECV), resource 1: account references.
 * Ordinary cross-account writers coexist; erasure waits for them and excludes new ones
 * until its reference scan commits. PostgreSQL releases this on commit or rollback.
 */
export async function lockAccountReferences(tx: DbClient, mode: 'write' | 'erase'): Promise<void> {
  const query =
    mode === 'erase'
      ? 'SELECT pg_advisory_xact_lock(:namespace::int, :resource::int)'
      : 'SELECT pg_advisory_xact_lock_shared(:namespace::int, :resource::int)';
  await tx.rawQuery(query, { namespace: 0x52454356, resource: 1 });
}
