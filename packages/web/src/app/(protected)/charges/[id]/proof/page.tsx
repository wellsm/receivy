import { AppShell } from "@/components/app/app-shell";
import { ProofViewerScreen } from "@/components/screens/proof-viewer-screen";

export default async function ProofPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell activePath="/billings" title="Comprovante" back={`/charges/${id}`}>
      <ProofViewerScreen chargeId={id} />
    </AppShell>
  );
}
