import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { ProofViewerScreen } from "@/components/screens/proof-viewer-screen";

export const Route = createFileRoute("/_protected/charges/$id/proof")({
  head: () => ({ meta: [{ title: "Comprovante | Receivy" }] }),
  component: ProofPage,
});

function ProofPage() {
  const { id } = Route.useParams();

  return (
    <AppShell activePath="/billings" title="Comprovante" back={`/charges/${id}`}>
      <ProofViewerScreen chargeId={id} />
    </AppShell>
  );
}
