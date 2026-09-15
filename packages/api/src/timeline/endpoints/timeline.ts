import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { BillingType, ChargeState, Direction, FeedStatus, type TimelinePage } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { AvatarRepository } from '../../users/repositories/avatar';
import { InvalidTimelineFilterError } from '../errors';
import type { TimelineProvider } from '../provider';
import { TimelineRepository } from '../repositories/timeline';

const DIRECTIONS: readonly Direction[] = [Direction.Receivable, Direction.Payable];
const STATUSES: readonly TimelineRepository.Status[] = [ChargeState.Pending, FeedStatus.Overdue, ChargeState.Paid, ChargeState.Cancelled];
const TYPES: readonly BillingType[] = [BillingType.Once, BillingType.Until, BillingType.Indefinite];

declare class TimelineRequest implements Http.Request {
  identity: SessionIdentity;
  query: {
    cursor?: String.Max<500>;
    /** `direction`, `status` and `type` are comma-separated lists: the gateway has no array query type. */
    direction?: String.Max<64>;
    status?: String.Max<64>;
    type?: String.Max<64>;
    from?: String.Date;
    to?: String.Date;
    /** `YYYY-MM`; defaults to the current month. Format is checked by `TimelineRepository.get`. */
    month?: String.Max<7>;
  };
}

declare class TimelineResponse implements Http.Response {
  status: 200;
  body: TimelinePage;
}

/** Splits a comma-separated filter, dropping repeats and rejecting anything outside `allowed`. */
function parseList<T extends string>(field: string, raw: string | undefined, allowed: readonly T[]): T[] {
  if (!raw) {
    return [];
  }

  // `%2C` because URLSearchParams escapes the separator; no allowed value ever contains a percent sign.
  const values = [
    ...new Set(
      raw
        .replace(/%2C/gi, ',')
        .split(',')
        .map((value) => value.trim())
    )
  ].filter(Boolean);

  const invalid = values.find((value) => !allowed.includes(value as T));

  if (invalid) {
    throw new InvalidTimelineFilterError(field, invalid);
  }

  return values as T[];
}

export async function timelineHandler(
  { identity, query }: TimelineRequest,
  { db, proofFiles }: Service.Context<TimelineProvider>
): Promise<TimelineResponse> {
  const { cursor, direction, status, type, from, to, month } = query;

  const filters = {
    cursor,
    from,
    to,
    month,
    direction: parseList('direction', direction, DIRECTIONS),
    status: parseList('status', status, STATUSES),
    type: parseList('type', type, TYPES)
  };

  return { status: 200, body: await AvatarRepository.sign(proofFiles, await TimelineRepository.get(db, identity.userId, filters)) };
}
