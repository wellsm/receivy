import { AppShell } from "@/components/app-shell";
import { PersonLedgerScreen } from "@/components/person-ledger-screen";
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AppShell activePath="/settings"><PersonLedgerScreen id={id} /></AppShell>; }
