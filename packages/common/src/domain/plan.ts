export const enum PlanTier {
  Free = 'free',
  Basic = 'basic'
}

export const enum SubscriptionProvider {
  Stripe = 'stripe'
}

/** Mirrors the provider's own states, collapsed to what the plan needs. */
export const enum SubscriptionStatus {
  Incomplete = 'incomplete',
  Active = 'active',
  PastDue = 'past_due',
  Canceled = 'canceled'
}

export type PlanLimits = { indefinite: number; checkoutLinks: boolean };

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  [PlanTier.Free]: { indefinite: 5, checkoutLinks: false },
  [PlanTier.Basic]: { indefinite: 30, checkoutLinks: true }
};

export type SubscriptionSnapshot = { status: SubscriptionStatus; currentPeriodEnd: string | null };

/** The plan in force: paid while the subscription is live and the paid period has not ended. Never stored. */
export function planOf(subscription: SubscriptionSnapshot | null, now: Date): PlanTier {
  if (!subscription) {
    return PlanTier.Free;
  }

  const live = subscription.status === SubscriptionStatus.Active || subscription.status === SubscriptionStatus.PastDue;

  if (!live) {
    return PlanTier.Free;
  }

  if (subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd).getTime() <= now.getTime()) {
    return PlanTier.Free;
  }

  return PlanTier.Basic;
}

export type PlanUsage = { indefinite: { used: number; limit: number } };

export type PlanCard = { brand: string; last4: string };

export type PlanSummary = {
  plan: PlanTier;
  status: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  usage: PlanUsage;
  checkoutLinks: boolean;
  card: PlanCard | null;
};

export type PlanInvoice = { id: string; amountCents: number; status: string; paidAt: string | null; pdfUrl: string | null };

export type SubscribeResult = { clientSecret: string };

export type SetupResult = { clientSecret: string };

export const PLAN_NAMES: Record<PlanTier, string> = {
  [PlanTier.Free]: 'Grátis',
  [PlanTier.Basic]: 'Básico'
};

export function planName(tier: PlanTier): string {
  return PLAN_NAMES[tier];
}

export const enum PlanErrorCode {
  LimitReached = 'PLAN_LIMIT_REACHED',
  Required = 'PLAN_REQUIRED'
}

export type PlanErrorPayload = { code: PlanErrorCode; message: string; fields: { limit?: number; used?: number; plan?: PlanTier } };

type ErrorBody = { message?: unknown; context?: { code?: unknown; fields?: Record<string, unknown> } };

function numberField(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : undefined;

  return parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
}

/** The two 402s the clients act on; anything else is somebody else's error. */
export function planErrorOf(body: unknown): PlanErrorPayload | null {
  const error = body as ErrorBody | null;
  const code = error?.context?.code;

  if (code !== PlanErrorCode.LimitReached && code !== PlanErrorCode.Required) {
    return null;
  }

  const fields = error?.context?.fields ?? {};
  const plan = fields.plan === PlanTier.Free || fields.plan === PlanTier.Basic ? fields.plan : undefined;

  return {
    code: code as PlanErrorCode,
    message: typeof error?.message === 'string' ? error.message : '',
    fields: {
      ...(numberField(fields.limit) !== undefined ? { limit: numberField(fields.limit) } : {}),
      ...(numberField(fields.used) !== undefined ? { used: numberField(fields.used) } : {}),
      ...(plan ? { plan } : {})
    }
  };
}
