import { randomBytes } from 'node:crypto';
import { Order } from '@ez4/database';
import { HttpNotFoundError } from '@ez4/gateway';
import {
  type BillingCategory,
  type BillingInvite,
  BillingState,
  type BillingType,
  Direction,
  type PublicInviteView,
  SplitPartKind
} from '@receivy/common';
import { lockOwner } from '../../charges/services/materialize';
import type { DbClient } from '../../database';
import {
  assertPublicLinkSecretConfigured,
  issuePublicChargeToken,
  PublicTokenPurpose,
  verifyPublicChargeToken
} from '../../public/services/capability';
import { InviteBillingInactiveError, PayableHasNoInviteError } from '../errors';

/** Secret and web origin the detail needs to re-issue the active invite URL. */
export type InviteLinkContext = { secret: string; webOrigin: string };

export const INVITE_SELECT = {
  id: true,
  billing_id: true,
  owner_id: true,
  public_id: true,
  expires_at: true,
  revoked_at: true,
  accepted_count: true,
  created_at: true
} as const;

export type InviteRow = {
  id: string;
  billing_id: string;
  owner_id: string;
  public_id: string;
  expires_at: string;
  revoked_at?: string;
  accepted_count: number;
  created_at: string;
};

/** The narrowest billing shape createInvite/revokeInvite need, so this module never depends on billings/repository. */
const OWNED_BILLING_SELECT = { id: true, state: true, direction: true } as const;

type OwnedBillingRow = { id: string; state: BillingState; direction?: Direction };

/** The narrowest billing shape a public invite preview needs. */
const PUBLIC_BILLING_SELECT = {
  id: true,
  description: true,
  total_cents: true,
  currency: true,
  type: true,
  category: true,
  state: true
} as const;

type PublicBillingRow = {
  id: string;
  description: string;
  total_cents: number;
  currency: 'BRL';
  type: BillingType;
  category: BillingCategory;
  state: BillingState;
};

/** The token is deterministic, so the invite row only stores the handle and its deadline. */
const TOKEN_VERSION = 1;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Verification must not fail on age alone; expiry is compared against the stored deadline instead. */
const IGNORE_EXPIRY = 0;

function seconds(instant: string): number {
  return Math.floor(new Date(instant).getTime() / 1000);
}

function inviteToken(row: Pick<InviteRow, 'public_id' | 'expires_at'>, secret: string): string {
  return issuePublicChargeToken({
    publicId: row.public_id,
    version: TOKEN_VERSION,
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

async function revokeActive(db: DbClient, billingId: string, now: string): Promise<void> {
  await db.billing_invites.updateMany({ where: { billing_id: billingId, revoked_at: { isNull: true } }, data: { revoked_at: now } });
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
    if (billing.direction === Direction.Payable) {
      throw new PayableHasNoInviteError();
    }

    const instant = now.toISOString();

    await revokeActive(tx, billing.id, instant);

    const created = await tx.billing_invites.insertOne({
      select: INVITE_SELECT,
      data: {
        id: crypto.randomUUID(),
        billing: { id: billing.id },
        owner: { id: ownerId },
        public_id: randomBytes(16).toString('base64url'),
        expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
        accepted_count: 0,
        created_at: instant
      }
    });

    return inviteResponse(created, secret, webOrigin);
  });
}

export async function revokeInvite(db: DbClient, ownerId: string, billingId: string, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);

    const billing = await ownedBilling(tx, ownerId, billingId, true);

    await revokeActive(tx, billing.id, now.toISOString());
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

  const { records } = await db.billing_invites.findMany({
    select: INVITE_SELECT,
    where: { billing_id: billingId, revoked_at: { isNull: true }, expires_at: { gt: now.toISOString() } },
    order: { created_at: Order.Desc },
    take: 1
  });

  const row = records[0];

  return row ? inviteResponse(row, secret, webOrigin) : null;
}

/** Resolves the signed handle; a bad signature or an unknown handle is indistinguishable from a miss. */
export async function resolveInvite(db: DbClient, token: string, secret: string): Promise<InviteRow> {
  assertPublicLinkSecretConfigured(secret);

  const publicId = token.split('.')[0];

  if (!publicId) {
    throw new HttpNotFoundError();
  }

  const row = await db.billing_invites.findOne({ select: INVITE_SELECT, where: { public_id: publicId } });

  if (!row) {
    throw new HttpNotFoundError();
  }

  let capability: { publicId: string; expiresAtSeconds: number };

  try {
    capability = verifyPublicChargeToken(token, {
      version: TOKEN_VERSION,
      nowSeconds: IGNORE_EXPIRY,
      secret,
      purpose: PublicTokenPurpose.Invite
    });
  } catch {
    throw new HttpNotFoundError();
  }

  if (capability.expiresAtSeconds !== seconds(row.expires_at)) {
    throw new HttpNotFoundError();
  }

  return row;
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

  const owner = await db.users.findOne({ select: { name: true }, where: { id: invite.owner_id } });

  return {
    expired: false,
    creditorFirstName: owner?.name?.trim().split(/\s+/)[0] || 'Pessoa',
    description: billing.description,
    amount: { amountCents: billing.total_cents, currency: billing.currency },
    type: billing.type,
    participantCount: await db.allocations.count({ where: { billing_id: billing.id, kind: SplitPartKind.User } }),
    category: billing.category
  };
}
