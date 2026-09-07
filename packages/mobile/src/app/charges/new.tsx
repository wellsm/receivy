import { useRouter } from "expo-router";
import { ChargeCreateScreen } from "@/components/charge-create-screen";
export default function NewChargeRoute() { const router = useRouter(); return <ChargeCreateScreen onBack={() => router.back()} onCreated={id => router.replace({ pathname: "/charges/[id]", params: { id } })} />; }
