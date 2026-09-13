import { createHash } from 'node:crypto';
import { BillingCategory, BillingDueRule, type NormalizedBillingInput } from '@receivy/common';

/** Canonical hash of a create request so an Idempotency-Key replay with a different body is refused. */
export function billingRequestFingerprint(input: NormalizedBillingInput): string {
  const canonical = JSON.stringify(
    {
      type: input.type,
      frequency: input.frequency ?? null,
      description: input.description,
      category: input.category ?? BillingCategory.Other,
      totalCents: input.totalCents,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      // Only the month end enters the hash, so replays of older fixed requests keep their fingerprint.
      ...(input.dueRule === BillingDueRule.EndOfMonth ? { dueRule: input.dueRule } : {}),
      timezone: input.timezone,
      paymentMethodId: input.paymentMethodId ?? null,
      reminders: input.reminders ?? null,
      split: input.split,
      direction: input.direction,
      payeeUserId: input.payeeUserId ?? null,
      pix: input.pix ?? null
    },
    (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
        : value
  );

  return createHash('sha256').update(canonical).digest('base64url');
}
