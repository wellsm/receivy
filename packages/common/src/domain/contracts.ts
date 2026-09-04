export type Money = {
  amountCents: number;
  currency: "BRL";
};

export type Direction = "receivable" | "payable";
export type ChargeState = "pending" | "paid" | "cancelled";
export type ProofState = "pending" | "accepted" | "rejected";
export type SplitMode = "fixed" | "equal" | "percentage";
export type RecurrenceFrequency = "monthly" | "yearly";

export type ChargeSummary = {
  id: string;
  description: string;
  amount: Money;
  dueDate: string;
  state: ChargeState;
};

export type ProofSummary = {
  id: string;
  chargeId: string;
  state: ProofState;
  createdAt: string;
};

export type PaymentSummary = {
  id: string;
  chargeId: string;
  amount: Money;
  paidAt: string;
};

export type RecurrencePreview = {
  recurrenceId: string;
  description: string;
  amount: Money;
  occurrenceDate: string;
};

export type TimelineItem =
  | { kind: "charge"; direction: Direction; charge: ChargeSummary }
  | { kind: "proof"; direction: Direction; proof: ProofSummary }
  | { kind: "payment"; direction: Direction; payment: PaymentSummary }
  | {
      kind: "recurrence_preview";
      direction: "receivable";
      preview: RecurrencePreview;
    };

export type HealthResponse = {
  status: "ok";
  service: "receivy-api";
};
