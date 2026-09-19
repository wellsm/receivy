import { AppShell } from "@/components/app/app-shell";
import { PaymentMethodsScreen } from "@/components/screens/payment-methods-screen";
import { safeNextPath } from "@/lib/auth/cookies";

export default async function PaymentMethodsPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; required?: string }> }) {
  const { returnTo, required } = await searchParams;
  const back = returnTo ? safeNextPath(returnTo) : "/settings";

  return (
    <AppShell activePath="/settings" title="Meios de pagamento" back={back}>
      <PaymentMethodsScreen returnTo={returnTo ? safeNextPath(returnTo) : undefined} required={required === "1"} />
    </AppShell>
  );
}
