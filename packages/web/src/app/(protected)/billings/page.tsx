import { AppShell } from "@/components/app/app-shell";
import { BillingsScreen } from "@/components/screens/billings-screen";
import { currentUser } from "@/lib/auth/current-user";

export default async function BillingsPage() {
  const user = await currentUser();

  return (
    <AppShell activePath="/billings">
      <BillingsScreen user={user} />
    </AppShell>
  );
}
