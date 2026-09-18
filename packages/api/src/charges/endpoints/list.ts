import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { Direction, type ListCharge, ProofKind, UserStatus } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { ChargeProvider } from '../provider';
import { ChargeRepository } from '../repositories/charge';
import { visibleProofState } from '../utils/proof';

declare class ListChargesRequest implements Http.Request {
  identity: SessionIdentity;
  query: {
    month: String.Max<7>;
  };
}

declare class ListChargesResponse implements Http.Response {
  status: 200;
  body: ListCharge;
}

type Person = { name?: string | null; email?: string | null; phone?: string | null; status: UserStatus } | null | undefined;

/** A reminder needs an address; the person on the other side of the owner has one or not. */
function reachable(person: Person): boolean {
  return !!person && !!(person.email || person.phone);
}

export async function listChargesHandler(
  { identity, query }: ListChargesRequest,
  { db }: Service.Context<ChargeProvider>
): Promise<ListChargesResponse> {
  const { userId } = identity;
  const { month } = query;

  const charges = await ChargeRepository.list(db, userId, { month });

  const body = charges.map(({ billing, creditor, debtor, proofs, ...charge }) => {
    const { owner_id, contact, ...rest } = billing;
    const ownedByViewer = owner_id === userId;
    const ownerPays = !!charge.debtor_id && charge.debtor_id === owner_id;
    const counterpart = ownerPays ? creditor : debtor;
    const proof = proofs?.[0];
    const proofState = visibleProofState(proof ?? null);

    return {
      id: charge.id,
      billingId: charge.billing_id,
      description: charge.description,
      installment: charge.installment,
      installmentCount: charge.installment_count,
      state: charge.state,
      dueDate: charge.due_date,
      amountCents: charge.amount_cents,
      type: charge.creditor_id === userId ? Direction.Receivable : Direction.Payable,
      ownedByViewer,
      hasPayment: !!charge.payment_snapshot,
      notify: !ownedByViewer || charge.notify,
      counterpartReachable: reachable(counterpart),
      confirmationRequired: !ownerPays || creditor?.status === UserStatus.Active,
      proof: proof && proofState ? { state: proofState, kind: proof.kind ?? ProofKind.File } : null,
      billing: { ...rest, contact: ownedByViewer ? (contact ?? null) : null },
      creditor: creditor ? { name: creditor.name } : undefined,
      debtor: debtor ? { name: debtor.name } : undefined
    };
  });

  return { status: 200, body };
}
