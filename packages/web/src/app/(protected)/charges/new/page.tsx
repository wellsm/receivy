"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BillingForm } from "@/components/billing-form";

export default function NewChargePage() {
  const router = useRouter();

  return (
    <AppShell hideCreateAction>
      <BillingForm billing={null} onSaved={(billing) => router.push(billing.charges[0] ? `/charges/${billing.charges[0].id}` : "/billings")} onBack={() => router.back()} />
    </AppShell>
  );
}
