import { AppShell } from "@/components/app-shell";
import { BillingsScreen } from "@/components/billings-screen";

export default function BillingsPage() {
  return (
    <AppShell activePath="/billings" hideCreateAction>
      <BillingsScreen />
    </AppShell>
  );
}
