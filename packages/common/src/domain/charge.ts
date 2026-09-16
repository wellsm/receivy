export type ListChargeItem = {
  id: string;
  description: string;
  installment?: number;
  installment_count?: number;
  state: string;
  due_date: string;
  amount_cents: number;
  billing: {
    type: string;
  };
  debtor?: {
    name?: string;
    email?: string;
    phone?: string;
  };
};

export type ListCharge = ListChargeItem[];