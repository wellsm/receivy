import { randomBytes } from 'node:crypto';
import { ChargeRepository } from '../../charges/repositories/charge';
import type { DbClient } from '../../database';
import { issuePublicChargeToken, PublicTokenPurpose } from './capability';

export const LINK_TTL_SECONDS = 90 * 24 * 60 * 60;

const sqlNull = null as unknown as undefined;

export type LinkColumns = Pick<ChargeRepository.Row, 'public_id' | 'link_version' | 'link_expires_at' | 'link_revoked_at'>;

/** A link the payer can still open: issued, not revoked, not expired. */
export function linkAlive(row: LinkColumns, nowSeconds: number): boolean {
  return !!row.public_id && !row.link_revoked_at && !!row.link_expires_at && Date.parse(row.link_expires_at) / 1000 > nowSeconds;
}

export function linkToken(
  row: Required<Pick<ChargeRepository.Row, 'public_id' | 'link_expires_at'>> & Pick<ChargeRepository.Row, 'link_version'>,
  secret: string
): string {
  return issuePublicChargeToken({
    publicId: row.public_id,
    version: row.link_version ?? 1,
    expiresAtSeconds: Math.floor(Date.parse(row.link_expires_at) / 1000),
    secret,
    purpose: PublicTokenPurpose.Charge
  });
}

/**
 * Makes sure the charge has a live public link, minting or rotating the columns in place. `rotate`
 * bumps the version so the previous token stops verifying. Returns the row as it stands afterwards.
 */
export async function ensurePublicLink(
  db: DbClient,
  row: ChargeRepository.Row,
  nowSeconds: number,
  rotate = false
): Promise<ChargeRepository.Row> {
  if (!rotate && linkAlive(row, nowSeconds)) {
    return row;
  }

  const stamp = new Date(nowSeconds * 1000).toISOString();
  const expiresAt = new Date((nowSeconds + LINK_TTL_SECONDS) * 1000).toISOString();

  await db.charges.updateOne({
    where: { id: row.id },
    data: {
      public_id: row.public_id ?? randomBytes(16).toString('base64url'),
      link_version: row.public_id ? (row.link_version ?? 1) + 1 : 1,
      link_expires_at: expiresAt,
      link_revoked_at: sqlNull,
      updated_at: stamp
    }
  });

  const updated = await db.charges.findOne({ select: ChargeRepository.SELECT, where: { id: row.id } });

  if (!updated) {
    throw new Error('Charge vanished while publishing its link.');
  }

  return updated;
}
