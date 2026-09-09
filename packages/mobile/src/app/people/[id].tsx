import { useLocalSearchParams, useRouter } from "expo-router";
import { PersonLedgerScreen } from "@/components/person-ledger-screen";

export default function LedgerRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <PersonLedgerScreen
      id={id}
      onNewCharge={() => router.push("/charges/new")}
      onEdit={() => router.push({ pathname: "/people/[id]/edit", params: { id } })}
      onOpenCharge={(chargeId) => router.push({ pathname: "/charges/[id]", params: { id: chargeId } })}
    />
  );
}
