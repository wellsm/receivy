import { HttpNotFoundError } from '@ez4/gateway';
import {
  type BillingCategory,
  type BillingInvite,
  type BillingKind,
  BillingState,
  type BillingType,
  Direction,
  type PublicInviteView
} from '@receivy/common';
import { SettledLockedError } from '../../billings/errors';
import { billingDirection, billingRecurrence, billingRegistered } from '../../billings/utils/columns';
import { lockOwner } from '../../charges/services/materialize';
import type { DbClient } from '../../database';
import { type LinkRow, LinkRepository } from '../../public/repositories/link';
import { LinkableType } from '../../public/schemas/link';
import {
  assertPublicLinkSecretConfigured,
  issuePublicChargeToken,
  PublicTokenPurpose,
  verifyPublicChargeToken
} from '../../public/services/capability';
import { InviteBillingInactiveError, PayableHasNoInviteError } from '../errors';

/** Secret and web origin the detail needs to re-issue the active invite URL. */
export type InviteLinkContext = { secret: string; webOrigin: string };

/**
 * An invite is a row in `links` pointing at the billing. What used to be its own table is the same handle,
 * the same deadline and the same revocation, so the two public links share one place and one token service.
 */
export type InviteRow = LinkRow & { billing_id: string };

/** The narrowest billing shape createInvite/revokeInvite need, so this module never depends on billings/repository. */
const OWNED_BILLING_SELECT = { id: true, state: true, direction: true, type: true, kind: true } as const;

type OwnedBillingRow = { id: string; state: BillingState; direction?: Direction; type?: Direction; kind: BillingKind };

/** The narrowest billing shape a public invite preview needs. */
const PUBLIC_BILLING_SELECT = {
  id: true,
  description: true,
  total_cents: true,
  recurrence: true,
  category: true,
  state: true
} as const;

type PublicBillingRow = {
  id: string;
  description: string;
  total_cents: number;
  recurrence: BillingType;
  category: BillingCategory;
  state: BillingState;
};

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Verification must not fail on age alone; expiry is compared against the stored deadline instead. */
const IGNORE_EXPIRY = 0;

function seconds(instant: string): number {
  return Math.floor(new Date(instant).getTime() / 1000);
}

/** The link row as the invite code reads it: the billing it points at, under its old name. */
function asInvite(link: LinkRow): InviteRow {
  return { ...link, billing_id: link.linkable_id };
}

function inviteToken(row: Pick<InviteRow, 'public_id' | 'expires_at'>, secret: string): string {
  return issuePublicChargeToken({
    publicId: row.public_id,
    expiresAtSeconds: seconds(row.expires_at),
    secret,
    purpose: PublicTokenPurpose.Invite
  });
}

function inviteResponse(row: Pick<InviteRow, 'public_id' | 'expires_at'>, secret: string, webOrigin: string): BillingInvite {
  return { url: `${webOrigin.replace(/\/+$/, '')}/join/${inviteToken(row, secret)}`, expiresAt: row.expires_at };
}

async function ownedBilling(db: DbClient, ownerId: string, billingId: string, lock = false): Promise<OwnedBillingRow> {
  const row = await db.billings.findOne({ select: OWNED_BILLING_SELECT, where: { id: billingId, owner_id: ownerId }, lock });

  if (!row) {
    throw new HttpNotFoundError();
  }

  return row;
}

export async function createInvite(
  db: DbClient,
  ownerId: string,
  billingId: string,
  secret: string,
  webOrigin: string,
  now = new Date()
): Promise<BillingInvite> {
  assertPublicLinkSecretConfigured(secret);

  return db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);

    const billing = await ownedBilling(tx, ownerId, billingId, true);

    if (billing.state !== BillingState.Active) {
      throw new InviteBillingInactiveError();
    }

    // A conta a pagar has no participants to invite.
    if (billingDirection(billing) === Direction.Payable) {
      throw new PayableHasNoInviteError();
    }

    // A registro belongs to the owner alone: nobody joins it.
    if (billingRegistered(billing)) {
      throw new SettledLockedError();
    }

    const instant = now.toISOString();
    const created = await LinkRepository.issue(
      tx,
      {
        linkableType: LinkableType.BillingInvite,
        linkableId: billing.id,
        expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
        acceptedCount: 0
      },
      instant
    );

    return inviteResponse(created, secret, webOrigin);
  });
}

export async function revokeInvite(db: DbClient, ownerId: string, billingId: string, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);

    const billing = await ownedBilling(tx, ownerId, billingId, true);

    await LinkRepository.revokeLive(tx, LinkableType.BillingInvite, billing.id, now.toISOString());
  });
}

/** Re-issues the URL of the still-usable invite; nothing is stored between reads. */
export async function activeInvite(
  db: DbClient,
  billingId: string,
  secret: string,
  webOrigin: string,
  now = new Date()
): Promise<BillingInvite | null> {
  if (!secret || secret === 'disabled') {
    return null;
  }

  const link = await LinkRepository.live(db, LinkableType.BillingInvite, billingId, Math.floor(now.getTime() / 1000));

  return link ? inviteResponse(link, secret, webOrigin) : null;
}

/** Resolves the signed handle; a bad signature or an unknown handle is indistinguishable from a miss. */
export async function resolveInvite(db: DbClient, token: string, secret: string): Promise<InviteRow> {
  assertPublicLinkSecretConfigured(secret);

  const publicId = token.split('.')[0];

  if (!publicId) {
    throw new HttpNotFoundError();
  }

  const link = await LinkRepository.byPublicId(db, publicId);

  if (!link || link.linkable_type !== LinkableType.BillingInvite) {
    throw new HttpNotFoundError();
  }

  let capability: { publicId: string; expiresAtSeconds: number };

  try {
    capability = verifyPublicChargeToken(token, {
      nowSeconds: IGNORE_EXPIRY,
      secret,
      purpose: PublicTokenPurpose.Invite
    });
  } catch {
    throw new HttpNotFoundError();
  }

  if (capability.expiresAtSeconds !== seconds(link.expires_at)) {
    throw new HttpNotFoundError();
  }

  return asInvite(link);
}

export async function getPublicInvite(db: DbClient, token: string, secret: string, now = new Date()): Promise<PublicInviteView> {
  return publicInviteView(db, await resolveInvite(db, token, secret), now);
}

export async function publicInviteView(db: DbClient, invite: InviteRow, now = new Date()): Promise<PublicInviteView> {
  const billing: PublicBillingRow | undefined = await db.billings.findOne({
    select: PUBLIC_BILLING_SELECT,
    where: { id: invite.billing_id }
  });

  if (!billing) {
    throw new HttpNotFoundError();
  }

  const expired = !!invite.revoked_at || new Date(invite.expires_at) <= now || billing.state !== BillingState.Active;

  if (expired) {
    return { expired: true };
  }

  const owner = await db.billings.findOne({ select: { owner_id: true }, where: { id: billing.id } });
  const user = owner ? await db.users.findOne({ select: { name: true }, where: { id: owner.owner_id } }) : undefined;

  return {
    expired: false,
    creditorFirstName: user?.name?.trim().split(/\s+/)[0] || 'Pessoa',
    description: billing.description,
    amount: { amountCents: billing.total_cents, currency: 'BRL' },
    type: billingRecurrence(billing),
    participantCount: owner
      ? await db.allocations.count({ where: { billing_id: billing.id, user_id: { not: owner.owner_id } } })
      : 0,
    category: billing.category
  };
}
