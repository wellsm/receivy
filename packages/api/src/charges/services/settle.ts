import { ChargeState, formatMoney, PaymentProvider, ProofKind } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { pushToUser } from '../../notifications/services/direct';
import type { NotificationTransport } from '../../notifications/services/transport';
import { ProofRepository } from '../../proofs/repositories/proof';
import type { CheckoutClients, CheckoutProvider } from '../../vendors/checkout/types';
import { ChargeRepository } from '../repositories/charge';
import { StoredProofState } from '../schemas/charge';
import { creditorOf, debtorOf, ownerOf, paymentOf } from '../utils/columns';
import { checkoutProviderOf } from './payment-link';

export type SettleOutcome = 'settled' | 'replayed' | 'ignored' | 'rejected' | 'mismatch' | 'unavailable';

export type SettleInput = { chargeId: string; transactionNsu: string; receiptUrl?: string } & (
  | { provider: PaymentProvider.InfinitePay; slug: string }
  | { provider: PaymentProvider.PagSeguro; credential: string; orderId: string }
);

export type SettleNotices = { transport: NotificationTransport; origin: string };

/** How the provider is named to a person; the events keep the enum value. */
function providerName(provider: CheckoutProvider): string {
  return provider === PaymentProvider.PagSeguro ? 'PagBank' : 'InfinitePay';
}

/** PagBank is masculine ("pelo PagBank", "no PagBank"); InfinitePay stays feminine ("pela InfinitePay", "na InfinitePay"). */
function providerArticle(provider: CheckoutProvider): { subject: string; in: string; by: string } {
  return provider === PaymentProvider.PagSeguro ? { subject: 'O', in: 'no', by: 'pelo' } : { subject: 'A', in: 'na', by: 'pela' };
}

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

/** Only a real provider receipt is kept: anything not starting with `https://` never reaches an event or a column. */
function safeReceipt(url?: string): string | undefined {
  return url?.startsWith('https://') ? url : undefined;
}

/**
 * The one finalizer behind the webhook and the payer's return. Nothing in the request is trusted: the provider is
 * asked (`payment_check`) before the charge moves. Idempotent by transaction nsu. A charge that is no longer
 * pending is never moved: the owner hears about the money and decides.
 */
export async function settleByProvider(db: DbClient, clients: CheckoutClients, notices: SettleNotices, input: SettleInput, now = new Date()): Promise<SettleOutcome> {
  const receiptUrl = safeReceipt(input.receiptUrl);
  const charge = await ChargeRepository.get(db, input.chargeId);
  const payment = charge ? paymentOf(charge) : null;
  const provider = payment ? checkoutProviderOf(payment.provider) : null;

  // A webhook of one provider never settles a charge frozen on another.
  if (!charge || !payment || !provider || provider !== input.provider) {
    return 'ignored';
  }

  if (charge.provider_transaction_id === input.transactionNsu) {
    return 'replayed';
  }

  const name = providerName(provider);
  const article = providerArticle(provider);
  const check = await clients[provider].checkPayment(
    input.provider === PaymentProvider.InfinitePay
      ? { provider: input.provider, identity: payment.value, orderNsu: charge.id, transactionNsu: input.transactionNsu, slug: input.slug }
      : { provider: input.provider, credential: input.credential, orderId: input.orderId, transactionNsu: input.transactionNsu }
  );
  const stamp = now.toISOString();
  const what = `${charge.description} · ${formatMoney({ amountCents: charge.amount_cents, currency: 'BRL' })}`;

  if (check.status === 'unavailable') {
    return 'unavailable';
  }

  if (check.status === 'unauthorized') {
    await record(db, charge.id, 'charge.provider.rejected', { transactionNsu: input.transactionNsu, reason: 'unauthorized' }, stamp);

    return 'rejected';
  }

  if (!check.paid) {
    await record(db, charge.id, 'charge.provider.rejected', { transactionNsu: input.transactionNsu, ...(input.provider === PaymentProvider.InfinitePay ? { slug: input.slug } : {}) }, stamp);

    return 'rejected';
  }

  if (check.amountCents < charge.amount_cents) {
    await record(db, charge.id, 'charge.provider.mismatch', { amountCents: check.amountCents, paidAmountCents: check.paidAmountCents, transactionNsu: input.transactionNsu }, stamp);
    await tell(
      db,
      notices,
      ownerOf(charge),
      `Valor divergente ${article.in} ${name}`,
      `${article.subject} ${name} confirmou ${formatMoney({ amountCents: check.amountCents, currency: 'BRL' })} para ${what}. Confira antes de marcar como pago.`,
      charge.id
    );

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
          `Pagamento recebido ${article.by} ${name}`,
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
      { via: 'provider', provider, transactionNsu: input.transactionNsu, paidAmountCents: check.paidAmountCents, captureMethod: check.captureMethod, receiptUrl },
      stamp
    );

    return {
      outcome: 'settled' as const,
      pushes: [
        ...push(creditorOf(locked), `Pagamento recebido ${article.by} ${name}`, `${what} foi paga pelo link.`, locked.id),
        ...push(debtorOf(locked), 'Pagamento confirmado', `${what} foi confirmada ${article.by} ${name}.`, locked.id)
      ]
    };
  });

  for (const item of pushes) {
    await tell(db, notices, item.userId, item.title, item.body, item.chargeId);
  }

  return outcome;
}
