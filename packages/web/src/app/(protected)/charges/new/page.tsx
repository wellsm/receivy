"use client";

import type { BillingDetail } from "@receivy/common";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BillingCreated } from "@/components/billing-created";
import { BillingForm } from "@/components/billing-form";

export default function NewChargePage() {
  const router = useRouter();
  const [created, setCreated] = useState<BillingDetail | null>(null);

  return (
    <AppShell activePath="/billings">
      {created ? <BillingCreated billing={created} /> : <BillingForm billing={null} onSaved={setCreated} onBack={() => router.back()} />}
    </AppShell>
  );
}
