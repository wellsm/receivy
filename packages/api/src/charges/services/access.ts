import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { type Direction, UserStatus } from '@receivy/common';
import type { DbClient } from '../../database';
import { AccountRepository } from '../../users/repositories/account';
import { ChargeRepository } from '../repositories/charge';
import { type Axis, creditorOf, debtorOf, directionOf, ownerPays, owns } from '../utils/columns';

/** The charge as `actorId` may touch it: owner, creditor or debtor; anyone else is refused, a dead account too. */
export async function chargeForActor(
  db: DbClient,
  actorId: string,
  id: string,
  lock = false
): Promise<{ row: ChargeRepository.Row; direction: Direction }> {
  if (!(await AccountRepository.isLive(db, actorId, lock))) {
    throw new HttpForbiddenError();
  }

  const row = await ChargeRepository.get(db, id, lock);

  if (!row) {
    throw new HttpNotFoundError();
  }

  if (owns(row, actorId) || creditorOf(row) === actorId || debtorOf(row) === actorId) {
    return { row, direction: directionOf(row, actorId) };
  }

  throw new HttpForbiddenError();
}

/**
 * Whether a payment the paying side declares waits for the other side. The owner of a conta a receber can
 * always answer; the payee of a conta a pagar only with an active account, otherwise the bill settles at once.
 */
export async function confirmationRequired(db: DbClient, row: Axis): Promise<boolean> {
  if (!ownerPays(row)) {
    return true;
  }

  const creditorId = creditorOf(row);

  return !!creditorId && (await AccountRepository.person(db, creditorId))?.status === UserStatus.Active;
}
