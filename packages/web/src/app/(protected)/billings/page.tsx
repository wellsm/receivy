import { AppShell } from "@/components/app/app-shell";
import { BillingsScreen } from "@/components/screens/billings-screen";

export default function BillingsPage() {
  return (
    <AppShell activePath="/billings">
      <BillingsScreen />
    </AppShell>
  );
}
