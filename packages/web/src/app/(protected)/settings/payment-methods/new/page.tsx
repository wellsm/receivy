import { AppShell } from "@/components/app/app-shell";
import { PaymentMethodFormScreen } from "@/components/forms/payment-method-form-screen";
import { safeNextPath } from "@/lib/auth/cookies";

export default async function NewPaymentMethodPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; required?: string }> }) {
  const { returnTo, required } = await searchParams;
  const safeReturn = returnTo ? safeNextPath(returnTo) : undefined;

  return (
    <AppShell activePath="/settings" title="Novo meio de pagamento" back={safeReturn ?? "/settings/payment-methods"}>
      <PaymentMethodFormScreen returnTo={safeReturn} required={required === "1"} />
    </AppShell>
  );
}
