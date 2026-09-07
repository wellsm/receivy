import { useLocalSearchParams, useRouter } from "expo-router";
import { PersonLedgerScreen } from "@/components/person-ledger-screen";
export default function LedgerRoute() { const router = useRouter(); const { id } = useLocalSearchParams<{ id: string }>(); return <PersonLedgerScreen onNewCharge={() => router.push("/charges/new")} id={id} onBack={() => router.back()} onOpenCharge={chargeId => router.push({ pathname: "/charges/[id]", params: { id: chargeId } })} />; }
