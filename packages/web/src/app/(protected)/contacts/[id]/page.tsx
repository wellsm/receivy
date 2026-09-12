import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PersonLedgerScreen } from "@/components/person-ledger-screen";
import { backLabelFor } from "@/lib/navigation";

const BACK_TO = "/people";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell activePath="/settings">
      <Link className="back-link" href={BACK_TO}>
        ← {backLabelFor(BACK_TO)}
      </Link>
      <PersonLedgerScreen id={id} />
    </AppShell>
  );
}
