"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { BillingFormScreen } from "@/components/forms/billing-form-screen";

export default function NewBillingPage() {
  const router = useRouter();

  return (
    <AppShell activePath="/billings" title="Nova conta" back="/billings">
      <BillingFormScreen billing={null} onSaved={(billing) => router.replace(`/billings/${billing.id}`)} />
    </AppShell>
  );
}
