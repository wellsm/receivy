import { AppShell } from "@/components/app-shell";
import { ChargeDetailScreen } from "@/components/charge-detail-screen";
export default async function ChargePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AppShell><ChargeDetailScreen id={id} /></AppShell>; }
