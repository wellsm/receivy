import { describe, expect, it } from 'vitest';
import { BillingKind, BillingRecurrence } from './billing';
import {
  canAcceptProof,
  canCancelCharge,
  canDeclarePayment,
  canMarkPaid,
  canRemind,
  canReopenCharge,
  canShare,
  canSilenceCharge,
  canUploadProof,
  canWithdrawProof,
  chargeInReview,
  chargeShareText,
  chargeStateTag,
  chargeStatusLine,
  chargeTypeLabel,
  counterpartRoleLabel,
  fileSizeText,
  proofNote,
  proofStateLabel
} from './charge-text';
import {
  type ChargeDetail,
  type ChargeProof,
  ChargeState,
  Direction,
  PaymentProvider,
  PixKeyType,
  ProofKind,
  ProofMime,
  ProofState,
  SharingState
} from './contracts';

function charge(overrides: Partial<ChargeDetail> = {}): ChargeDetail {
  return {
    id: 'charge',
    direction: Direction.Payable,
    description: 'Aluguel',
    amount: { amountCents: 2500, currency: 'BRL' },
    dueDate: '2026-09-10',
    state: ChargeState.Pending,
    billingId: 'b1',
    recurrence: BillingRecurrence.Until,
    installment: 2,
    installmentCount: 3,
    counterpartName: 'Ana',
    proofState: null,
    recipient: { userId: 'ana', name: 'Ana', email: null },
    debtorId: 'ana',
    payment: null,
    paymentLink: null,
    receiptUrl: null,
    sharingState: SharingState.Ready,
    proof: null,
    cancelledAt: null,
    paidAt: null,
    createdAt: '2026-09-01',
    ...overrides
  };
}

function proof(overrides: Partial<ChargeProof> = {}): ChargeProof {
  return {
    state: ProofState.Pending,
    kind: ProofKind.File,
    file: { name: 'comprovante.pdf', mime: ProofMime.Pdf, size: 184 * 1024 },
    sentAt: '2026-09-05T14:32:00Z',
    reviewedAt: null,
    reason: null,
    sentByViewer: true,
    ...overrides
  };
}

describe('charge text', () => {
  it('names the installment, the recurrence or the single payment', () => {
    expect(chargeTypeLabel(charge())).toBe('Parcela 2 de 3');
    expect(chargeTypeLabel(charge({ recurrence: BillingRecurrence.Indefinite }))).toBe('Recorrente');
    expect(chargeTypeLabel(charge({ recurrence: BillingRecurrence.Once }))).toBe('À vista');
  });

  it('describes the due date relative to today', () => {
    expect(chargeStatusLine(charge(), '2026-09-07')).toEqual({ text: 'Vence em 3 dias', tone: 'warning' });
    expect(chargeStatusLine(charge(), '2026-09-10')).toEqual({ text: 'Vence hoje', tone: 'warning' });
    expect(chargeStatusLine(charge(), '2026-09-11')).toEqual({ text: 'Atrasada há 1 dia', tone: 'danger' });
    expect(chargeStatusLine(charge({ state: ChargeState.Cancelled }), '2026-09-11')).toEqual({ text: 'Cancelada', tone: 'neutral' });
    expect(chargeStatusLine(charge({ state: ChargeState.Paid, paidAt: '2026-09-08T15:04:00Z' }), '2026-09-11', 'UTC')).toEqual({
      text: 'Pago em 08/09 às 15:04',
      tone: 'success'
    });
  });

  it('tags a pending charge by how its due date relates to today, agreeing with the feed', () => {
    expect(chargeStateTag(charge(), '2026-09-07')).toEqual({ label: 'Pendente', tone: 'warning' });
    expect(chargeStateTag(charge(), '2026-09-10')).toEqual({ label: 'Vence hoje', tone: 'danger' });
    expect(chargeStateTag(charge(), '2026-09-11')).toEqual({ label: 'Atrasado', tone: 'danger' });
    expect(chargeStateTag(charge({ state: ChargeState.Paid }), '2026-09-11')).toEqual({ label: 'Pago', tone: 'success' });
    expect(chargeStateTag(charge({ state: ChargeState.Cancelled }), '2026-09-11')).toEqual({ label: 'Cancelada', tone: 'neutral' });
  });

  it('labels and explains a proof', () => {
    expect(proofStateLabel(proof())).toEqual({ label: 'Em revisão', tone: 'warning' });
    expect(proofStateLabel(proof({ state: ProofState.Accepted }))).toEqual({ label: 'Aceito', tone: 'success' });
    expect(proofStateLabel(proof({ state: ProofState.Rejected }))).toEqual({ label: 'Rejeitado', tone: 'danger' });
    expect(proofNote(charge())).toBeNull();
    expect(proofNote(charge({ proof: proof() }))).toBeNull();
    expect(proofNote(charge({ proof: proof({ state: ProofState.Rejected, reason: 'Ilegível' }) }))).toBe(
      'Comprovante rejeitado: Ilegível. Você pode enviar outro arquivo.'
    );
    expect(proofNote(charge({ direction: Direction.Receivable, proof: proof({ state: ProofState.Rejected }) }))).toBe(
      'Comprovante rejeitado.'
    );
    expect(proofNote(charge({ state: ChargeState.Cancelled, proof: proof() }))).toBe(
      'A cobrança foi cancelada; este comprovante não foi avaliado.'
    );
    expect(proofNote(charge({ state: ChargeState.Paid, proof: proof() }))).toBe(
      'A cobrança foi paga por fora; este comprovante não foi avaliado.'
    );
  });

  it('formats sizes', () => {
    expect(fileSizeText(184 * 1024)).toBe('184 KB');
    expect(fileSizeText(1.5 * 1024 * 1024)).toBe('1,5 MB');
  });

  it('gates upload, withdrawal and acceptance by direction and state', () => {
    expect(canUploadProof(charge())).toBe(true);
    expect(canUploadProof(charge({ proof: proof() }))).toBe(false);
    expect(canUploadProof(charge({ proof: proof({ state: ProofState.Rejected }) }))).toBe(true);
    expect(canUploadProof(charge({ state: ChargeState.Paid }))).toBe(false);
    expect(canUploadProof(charge({ direction: Direction.Receivable }))).toBe(false);
    expect(canWithdrawProof(charge({ proof: proof() }))).toBe(true);
    expect(canWithdrawProof(charge({ proof: proof({ sentByViewer: false }) }))).toBe(false);
    expect(canWithdrawProof(charge({ proof: proof({ state: ProofState.Rejected }) }))).toBe(false);
    expect(canWithdrawProof(charge({ direction: Direction.Receivable, proof: proof() }))).toBe(false);
    expect(canAcceptProof(charge({ direction: Direction.Receivable, proof: proof() }))).toBe(true);
    expect(canAcceptProof(charge({ direction: Direction.Receivable, proof: proof({ state: ProofState.Rejected }) }))).toBe(false);
    expect(canAcceptProof(charge({ proof: proof() }))).toBe(false);
  });
});

describe('action gates on a conta a pagar', () => {
  const payment = { provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: 'pay@example.com', label: 'Pix' };
  const owner = charge({ direction: Direction.Payable, ownedByViewer: true, payment, counterpartName: 'Ana' });
  const payee = charge({ direction: Direction.Receivable, ownedByViewer: false, payment, counterpartName: 'Lucas' });
  const creditor = charge({ direction: Direction.Receivable, ownedByViewer: true, payment });

  it('lets the owner settle their own bill but never remind, share or cancel a single charge', () => {
    expect(canMarkPaid(owner)).toBe(true);
    expect(canRemind(owner)).toBe(false);
    expect(canShare(owner)).toBe(false);
    expect(canCancelCharge(owner)).toBe(false);
    expect(counterpartRoleLabel(owner)).toBe('Vai receber de você');
    expect(counterpartRoleLabel(charge({ ...owner, counterpartName: 'Você' }))).toBe('Conta só sua');
  });

  it('lets the payee confirm receipt only', () => {
    expect(canMarkPaid(payee)).toBe(true);
    expect(canReopenCharge({ ...payee, state: ChargeState.Paid })).toBe(true);
    expect(canReopenCharge({ ...owner, state: ChargeState.Paid })).toBe(true);
    expect(canReopenCharge(payee)).toBe(false);
    expect(canRemind(payee)).toBe(false);
    expect(canShare(payee)).toBe(false);
    expect(canCancelCharge(payee)).toBe(false);
    expect(counterpartRoleLabel(payee)).toBe('Vai pagar para você');
  });

  it('keeps every power for the creditor of a conta a receber', () => {
    expect(canMarkPaid(creditor)).toBe(true);
    expect(canRemind(creditor)).toBe(true);
    expect(canRemind({ ...creditor, counterpartReachable: false })).toBe(false);
    expect(canRemind({ ...creditor, proofState: ProofState.Pending })).toBe(false);
    expect(canShare(creditor)).toBe(true);
    expect(canCancelCharge(creditor)).toBe(true);
    expect(canMarkPaid(charge({ direction: Direction.Payable }))).toBe(false);
  });
});

describe('payment declarations', () => {
  const declared = (overrides: Partial<ChargeProof> = {}) => proof({ kind: ProofKind.Declaration, file: null, ...overrides });

  it('reads in review while anything waits for an answer', () => {
    expect(chargeInReview(charge({ proofState: ProofState.Pending }))).toBe(true);
    expect(chargeInReview(charge({ proofState: ProofState.Rejected }))).toBe(false);
    expect(chargeInReview(charge({ state: ChargeState.Paid, proofState: ProofState.Pending }))).toBe(false);
  });

  it('lets the paying side declare while nothing is under review', () => {
    expect(canDeclarePayment(charge())).toBe(true);
    expect(canDeclarePayment(charge({ proofState: ProofState.Pending, proof: declared() }))).toBe(false);
    expect(canDeclarePayment(charge({ direction: Direction.Receivable }))).toBe(false);
    expect(canDeclarePayment(charge({ state: ChargeState.Paid }))).toBe(false);
  });

  it('asks the owner of a conta a pagar to declare only when the payee can confirm', () => {
    const own = charge({ ownedByViewer: true });

    expect(canDeclarePayment({ ...own, confirmationRequired: true })).toBe(true);
    expect(canDeclarePayment({ ...own, confirmationRequired: false })).toBe(false);
    expect(canMarkPaid({ ...own, confirmationRequired: true })).toBe(false);
    expect(canMarkPaid({ ...own, confirmationRequired: false })).toBe(true);
  });

  it('lets the sender attach a file over their own declaration', () => {
    expect(canUploadProof(charge({ proofState: ProofState.Pending, proof: declared() }))).toBe(true);
    expect(canUploadProof(charge({ proofState: ProofState.Pending, proof: declared({ sentByViewer: false }) }))).toBe(false);
    expect(canWithdrawProof(charge({ proofState: ProofState.Pending, proof: declared() }))).toBe(true);
    expect(canAcceptProof(charge({ direction: Direction.Receivable, proofState: ProofState.Pending, proof: declared() }))).toBe(true);
  });

  it('explains a declaration the other side did not recognise', () => {
    expect(proofNote(charge({ proof: declared({ state: ProofState.Rejected, reason: 'Não caiu na conta' }) }))).toBe(
      'Pagamento não identificado: Não caiu na conta. Você pode informar de novo ou enviar um comprovante.'
    );
  });
});

describe('chargeShareText', () => {
  it('lists what, how much and when before the link', () => {
    expect(
      chargeShareText(
        { description: 'Aluguel', amount: { amountCents: 120_000, currency: 'BRL' }, dueDate: '2026-11-15' },
        'https://r.test/pay/x'
      )
    ).toBe('Aluguel · R$\u00a01.200,00 · vence em 15/11/2026\nPague pelo link: https://r.test/pay/x');
  });
});

describe('silenced charges', () => {
  it('lets only the creditor of a pending conta a receber pause its notices', () => {
    const creditor = charge({ direction: Direction.Receivable, ownedByViewer: true });

    expect(canSilenceCharge(creditor)).toBe(true);
    expect(canSilenceCharge({ ...creditor, notify: false })).toBe(true);
    expect(canSilenceCharge({ ...creditor, state: ChargeState.Paid })).toBe(false);
    expect(canSilenceCharge({ ...creditor, ownedByViewer: false })).toBe(false);
    expect(canSilenceCharge(charge({ direction: Direction.Payable }))).toBe(false);
    expect(canSilenceCharge(charge({ direction: Direction.Receivable, ownedByViewer: false }))).toBe(false);
    expect(canSilenceCharge({ ...creditor, counterpartReachable: false })).toBe(false);
  });
});

describe('registros', () => {
  const payment = { provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: 'pay@example.com', label: 'Pix' };
  const received = charge({
    direction: Direction.Receivable,
    ownedByViewer: true,
    payment,
    debtorId: null,
    kind: BillingKind.Record
  });
  const paid = charge({
    direction: Direction.Payable,
    ownedByViewer: true,
    debtorId: null,
    confirmationRequired: false,
    kind: BillingKind.Record
  });

  it('never reminds, shares, silences or takes a proof, and still settles and reopens by hand', () => {
    expect(canRemind(received)).toBe(false);
    expect(canRemind({ ...received, kind: BillingKind.Live })).toBe(true);
    expect(canShare(received)).toBe(false);
    expect(canShare({ ...received, kind: BillingKind.Live })).toBe(true);
    expect(canSilenceCharge(received)).toBe(false);
    expect(canSilenceCharge({ ...received, kind: BillingKind.Live })).toBe(true);
    expect(canMarkPaid(received)).toBe(true);
    expect(canReopenCharge({ ...received, state: ChargeState.Paid })).toBe(true);
    expect(canUploadProof(paid)).toBe(false);
    expect(canUploadProof({ ...paid, kind: BillingKind.Live })).toBe(true);
    expect(canMarkPaid(paid)).toBe(true);
  });
});
