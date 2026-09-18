import { ChargeState, formatMoney, PaymentProvider, ProofKind } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { pushToUser } from '../../notifications/services/direct';
import type { NotificationTransport } from '../../notifications/services/transport';
import { ProofRepository } from '../../proofs/repositories/proof';
import type { PaymentLinkProvider } from '../../vendors/infinitepay/types';
import { ChargeRepository } from '../repositories/charge';
import { StoredProofState } from '../schemas/charge';
import { creditorOf, debtorOf, ownerOf, paymentOf } from '../utils/columns';

export type SettleOutcome = 'settled' | 'replayed' | 'ignored' | 'rejected' | 'mismatch' | 'unavailable';

export type SettleInput = { chargeId: string; transactionNsu: string; slug: string; receiptUrl?: string };

export type SettleNotices = { transport: NotificationTransport; origin: string };

function record(db: DbClient, chargeId: string, type: string, payload: Record<string, unknown>, at: string) {
  return EventRepository.record(db, { type, eventableType: EventableType.Charge, eventableId: chargeId, payload, at });
}

async function tell(db: DbClient, notices: SettleNotices, userId: string | undefined, title: string, body: string, chargeId: string): Promise<void> {
  if (!userId) {
    return;
  }

  await pushToUser(db, notices.transport, userId, { title, body, url: `${notices.origin.replace(/\/+$/, '')}/charges/${chargeId}` });
}

type PendingPush = { userId: string; title: string; body: string; chargeId: string };

/** Never call `tell` from inside the transaction: an external push must not block on an open lock. Collect it instead. */
function push(userId: string | undefined, title: string, body: string, chargeId: string): PendingPush[] {
  return userId ? [{ userId, title, body, chargeId }] : [];
}

/** Only a real InfinitePay receipt is kept: anything not starting with `https://` never reaches an event or a column. */
function safeReceipt(url?: string): string | undefined {
  return url?.startsWith('https://') ? url : undefined;
}

/**
 * The one finalizer behind the webhook and the payer's return. Nothing in the request is trusted: the provider is
 * asked (`payment_check`) before the charge moves. Idempotent by transaction nsu. A charge that is no longer
 * pending is never moved: the owner hears about the money and decides.
 */
export async function settleByProvider(db: DbClient, links: PaymentLinkProvider, notices: SettleNotices, input: SettleInput, now = new Date()): Promise<SettleOutcome> {
  const receiptUrl = safeReceipt(input.receiptUrl);
  const charge = await ChargeRepository.get(db, input.chargeId);
  const payment = charge ? paymentOf(charge) : null;

  if (!charge || payment?.provider !== PaymentProvider.InfinitePay) {
    return 'ignored';
  }

  if (charge.provider_transaction_id === input.transactionNsu) {
    return 'replayed';
  }

  const check = await links.checkPayment({ handle: payment.value, orderNsu: charge.id, transactionNsu: input.transactionNsu, slug: input.slug });
  const stamp = now.toISOString();
  const what = `${charge.description} · ${formatMoney({ amountCents: charge.amount_cents, currency: 'BRL' })}`;

  if (check.status === 'unavailable') {
    return 'unavailable';
  }

  if (!check.paid) {
    await record(db, charge.id, 'charge.provider.rejected', { transactionNsu: input.transactionNsu, slug: input.slug }, stamp);

    return 'rejected';
  }

  if (check.amountCents < charge.amount_cents) {
    await record(db, charge.id, 'charge.provider.mismatch', { amountCents: check.amountCents, paidAmountCents: check.paidAmountCents, transactionNsu: input.transactionNsu }, stamp);
    await tell(db, notices, ownerOf(charge), 'Valor divergente na InfinitePay', `A InfinitePay confirmou ${formatMoney({ amountCents: check.amountCents, currency: 'BRL' })} para ${what}. Confira antes de marcar como pago.`, charge.id);

    return 'mismatch';
  }

  const { outcome, pushes } = await db.transaction(async (tx) => {
    const locked = await ChargeRepository.get(tx, charge.id, true);

    if (!locked) {
      return { outcome: 'ignored' as const, pushes: [] as PendingPush[] };
    }

    if (locked.provider_transaction_id === input.transactionNsu) {
      return { outcome: 'replayed' as const, pushes: [] as PendingPush[] };
    }

    if (locked.state !== ChargeState.Pending) {
      await record(tx, locked.id, 'charge.provider.ignored', { state: locked.state, transactionNsu: input.transactionNsu, receiptUrl }, stamp);

      return {
        outcome: 'ignored' as const,
        pushes: push(
          ownerOf(locked),
          'Pagamento recebido pela InfinitePay',
          `${what} já estava ${locked.state === ChargeState.Paid ? 'paga' : 'cancelada'} e recebeu um pagamento pelo link.`,
          locked.id
        )
      };
    }

    // Whatever waited in review is answered by the provider, like a manual settlement would.
    const proof = await ProofRepository.current(tx, locked.id, true);

    if (proof?.state === StoredProofState.Pending) {
      const declaration = proof.kind === ProofKind.Declaration;

      await ProofRepository.answer(tx, proof.id, { state: StoredProofState.Accepted, dropFile: declaration }, stamp);
      await record(tx, locked.id, 'proof.accepted', { name: declaration ? undefined : proof.file?.name }, stamp);
    }

    await ChargeRepository.markPaidByProvider(tx, locked.id, { paidAt: stamp, transactionId: input.transactionNsu, receiptUrl }, stamp);
    await record(
      tx,
      locked.id,
      'charge.paid',
      { via: 'provider', provider: PaymentProvider.InfinitePay, transactionNsu: input.transactionNsu, paidAmountCents: check.paidAmountCents, captureMethod: check.captureMethod, receiptUrl },
      stamp
    );

    return {
      outcome: 'settled' as const,
      pushes: [
        ...push(creditorOf(locked), 'Pagamento recebido pela InfinitePay', `${what} foi paga pelo link.`, locked.id),
        ...push(debtorOf(locked), 'Pagamento confirmado', `${what} foi confirmada pela InfinitePay.`, locked.id)
      ]
    };
  });

  for (const item of pushes) {
    await tell(db, notices, item.userId, item.title, item.body, item.chargeId);
  }

  return outcome;
}
