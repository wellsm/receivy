import { describe, expect, it } from 'vitest';
import { BillingType } from './billing';
import {
  canAcceptProof,
  canCancelCharge,
  canMarkPaid,
  canRemind,
  canReopenCharge,
  canShare,
  canUploadProof,
  canWithdrawProof,
  chargeShareText,
  chargeStatusLine,
  chargeTypeLabel,
  counterpartRoleLabel,
  fileSizeText,
  proofNote,
  proofStateLabel
} from './charge-text';
import {
  type ChargeDetail,
  ChargePayer,
  type ChargeProof,
  ChargeState,
  Direction,
  PixKeyType,
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
    billingType: BillingType.Until,
    installment: 2,
    installmentCount: 3,
    counterpartName: 'Ana',
    proofState: null,
    recipient: { userId: 'ana', name: 'Ana', email: null },
    debtorUserId: 'ana',
    pix: null,
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
    expect(chargeTypeLabel(charge({ billingType: BillingType.Indefinite }))).toBe('Recorrente');
    expect(chargeTypeLabel(charge({ billingType: BillingType.Once }))).toBe('À vista');
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
  const pix = { keyType: PixKeyType.Email, key: 'pay@example.com', label: 'Pix' };
  const owner = charge({ direction: Direction.Payable, payer: ChargePayer.Owner, ownedByViewer: true, pix, counterpartName: 'Ana' });
  const payee = charge({ direction: Direction.Receivable, payer: ChargePayer.Owner, ownedByViewer: false, pix, counterpartName: 'Lucas' });
  const creditor = charge({ direction: Direction.Receivable, ownedByViewer: true, pix });

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
