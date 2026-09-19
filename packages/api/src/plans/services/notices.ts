import type { DbClient } from '../../database';
import { pushToUser } from '../../notifications/services/direct';
import type { NotificationTransport } from '../../notifications/services/transport';
import { AccountRepository } from '../../users/repositories/account';

export type PlanNotices = { transport: NotificationTransport; origin: string; from: string };

export const enum PlanNoticeKind {
  Subscribed = 'subscribed',
  PaymentFailed = 'payment_failed',
  Canceled = 'canceled'
}

const COPY: Record<PlanNoticeKind, { title: string; subject: string; body: (paused: number) => string }> = {
  [PlanNoticeKind.Subscribed]: { title: 'Plano Básico ativo', subject: 'Seu plano Básico está ativo', body: () => 'Obrigado! Você já pode ter até 30 cobranças indefinidas ativas e usar links de pagamento.' },
  [PlanNoticeKind.PaymentFailed]: { title: 'Pagamento do plano falhou', subject: 'Atualize o cartão do seu plano', body: () => 'Não conseguimos cobrar seu cartão. Atualize o cartão em Plano para manter o Básico; o Stripe tenta de novo nos próximos dias.' },
  [PlanNoticeKind.Canceled]: {
    title: 'Seu plano Básico acabou',
    subject: 'Seu plano Básico acabou',
    body: (paused) => (paused ? `Voltamos ao plano Grátis e pausamos ${paused} cobrança(s) que passavam do limite ou dependiam de link de pagamento. Reative-as em Contas quando quiser.` : 'Voltamos ao plano Grátis. Suas cobranças continuam como estão.')
  }
};

/** E-mail + push to the owner after the transaction committed; failures never reach the caller. */
export async function notifyPlan(db: DbClient, notices: PlanNotices, ownerId: string, kind: PlanNoticeKind, pausedCount: number, eventId: string): Promise<void> {
  const copy = COPY[kind];
  const url = `${notices.origin.replace(/\/+$/, '')}/settings/plan`;
  const account = await AccountRepository.get(db, ownerId);
  const email = account?.verified_email ?? account?.email;

  if (email) {
    await notices.transport.email({ to: email, key: `plan:${ownerId}:${kind}:${eventId}`, subject: copy.subject, text: `${copy.body(pausedCount)}\n\n${url}`, from: notices.from });
  }

  await pushToUser(db, notices.transport, ownerId, { title: copy.title, body: copy.body(pausedCount), url });
}
