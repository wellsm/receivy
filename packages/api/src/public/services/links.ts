import type { DbClient } from '../../database';
import { type LinkRow, LinkRepository } from '../repositories/link';
import { LinkableType } from '../schemas/link';
import { issuePublicChargeToken, PublicTokenPurpose } from './capability';

export const LINK_TTL_SECONDS = 90 * 24 * 60 * 60;

/** A link the payer can still open: issued, not revoked, not expired. */
export function linkAlive(link: LinkRow | null, nowSeconds: number): boolean {
  return !!link && !link.revoked_at && Date.parse(link.expires_at) / 1000 > nowSeconds;
}

export function linkToken(link: Pick<LinkRow, 'public_id' | 'version' | 'expires_at'>, secret: string): string {
  return issuePublicChargeToken({
    publicId: link.public_id,
    version: link.version,
    expiresAtSeconds: Math.floor(Date.parse(link.expires_at) / 1000),
    secret,
    purpose: PublicTokenPurpose.Charge
  });
}

/**
 * Makes sure the charge has a live public link. `rotate` revokes the live row and issues a new handle, so
 * the previous token stops resolving — the row is the rotation now, instead of a bumped version column.
 */
export async function ensurePublicLink(db: DbClient, chargeId: string, nowSeconds: number, rotate = false): Promise<LinkRow> {
  const live = await LinkRepository.live(db, LinkableType.Charge, chargeId, nowSeconds);

  if (!rotate && live) {
    return live;
  }

  const now = new Date(nowSeconds * 1000).toISOString();
  const expiresAt = new Date((nowSeconds + LINK_TTL_SECONDS) * 1000).toISOString();

  return LinkRepository.issue(db, { linkableType: LinkableType.Charge, linkableId: chargeId, expiresAt }, now);
}

/** The live link of a charge, if it has one; the caller decides what to do when it does not. */
export async function liveChargeLink(db: DbClient, chargeId: string, nowSeconds?: number): Promise<LinkRow | null> {
  return LinkRepository.live(db, LinkableType.Charge, chargeId, nowSeconds);
}
