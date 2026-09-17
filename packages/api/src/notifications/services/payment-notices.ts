import { ChargePayer, formatMoney } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { currentProof } from '../../proofs/repositories/proof-row';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { pushToUser } from './direct';
import { type NotificationTransport, notificationTransport } from './transport';

export const enum PaymentNotice {
  Declared = 'declared',
  ProofReceived = 'proof_received',
  Confirmed = 'confirmed',
  NotIdentified = 'not_identified'
}

export type PaymentNoticeContext = { transport: NotificationTransport; origin: string };

export type PaymentNoticeVariables = { PUBLIC_WEB_ORIGIN: string; NOTIFICATION_PUSH_TRANSPORT?: string; EXPO_ACCESS_TOKEN?: string };

/** Push only: the provider's e-mail settings are not needed, so the transport's e-mail side answers `disabled`. */
export function paymentNoticeContext(variables: PaymentNoticeVariables): PaymentNoticeContext {
  return { transport: notificationTransport({ ...variables }), origin: variables.PUBLIC_WEB_ORIGIN };
}

function copy(notice: PaymentNotice, name: string, what: string, reason: string | undefined) {
  switch (notice) {
    case PaymentNotice.Declared:
      return { title: 'Pagamento informado', body: `${name} disse que pagou ${what}. Confirme o recebimento.` };

    case PaymentNotice.ProofReceived:
      return { title: 'Comprovante recebido', body: `${name} enviou o comprovante de ${what}.` };

    case PaymentNotice.Confirmed:
      return { title: 'Pagamento confirmado', body: `${name} confirmou ${what}.` };

    default:
      return { title: 'Pagamento não identificado', body: `${name}: ${reason ?? 'o pagamento não foi identificado.'}` };
  }
}

/**
 * Tells the other side of a payment under review: whoever answers hears about a declaration or a file, whoever
 * paid hears the answer. One push per submission and notice, sent after the action committed; it never throws.
 * `performedBy` is the user who acted, when known: nobody is pushed about their own action.
 */
export async function pushPaymentNotice(
  db: DbClient,
  context: PaymentNoticeContext,
  chargeId: string,
  notice: PaymentNotice,
  performedBy?: string
): Promise<void> {
  try {
    const charge = await db.charges.findOne({
      select: {
        creditor_id: true,
        debtor_user_id: true,
        payer: true,
        description: true,
        amount_cents: true
      },
      where: { id: chargeId }
    });

    if (!charge) {
      return;
    }

    const proof = await currentProof(db, chargeId);

    const ownerPays = charge.payer === ChargePayer.Owner;
    const payerId = ownerPays ? charge.creditor_id : charge.debtor_user_id;
    const reviewerId = ownerPays ? charge.debtor_user_id : charge.creditor_id;
    const toReviewer = notice === PaymentNotice.Declared || notice === PaymentNotice.ProofReceived;
    const recipientId = toReviewer ? reviewerId : payerId;
    const actorId = toReviewer ? payerId : reviewerId;

    if (!recipientId) {
      return;
    }

    // An owner with no payee to confirm settles their own pending file: a confirmation of their own act is no news.
    if (recipientId === performedBy) {
      return;
    }

    // Completing an upload and the bucket event may both report the same file.
    const key = `${notice}:${proof?.sent_at ?? ''}`;

    if ((await EventRepository.list(db, chargeId, 'notice.payment')).some((event) => event.payload['key'] === key)) {
      return;
    }

    const actor = actorId ? await db.users.findOne({ select: { name: true }, where: { id: actorId } }) : undefined;
    const name = actor?.name?.trim().split(/\s+/)[0] || 'Alguém';
    const what = `${charge.description} · ${formatMoney({ amountCents: charge.amount_cents, currency: 'BRL' })}`;

    await pushToUser(db, context.transport, recipientId, {
      ...copy(notice, name, what, proof?.reason),
      url: `${context.origin.replace(/\/+$/, '')}/charges/${chargeId}`
    });
    await EventRepository.record(db, {
      type: 'notice.payment',
      eventableType: EventableType.Charge,
      eventableId: chargeId,
      payload: { key, notice }
    });
  } catch (error) {
    console.error('Payment notice failed', { chargeId, notice, error: error instanceof Error ? error.message : 'unknown' });
  }
}
