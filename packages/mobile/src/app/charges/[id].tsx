import { useLocalSearchParams, useRouter } from "expo-router";
import { ChargeDetailScreen } from "@/components/charge-detail-screen";
export default function ChargeRoute() { const router = useRouter(); const { id } = useLocalSearchParams<{ id: string }>(); return <ChargeDetailScreen id={id} onBack={() => router.replace("/")} />; }
