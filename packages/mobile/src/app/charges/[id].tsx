import { useLocalSearchParams } from "expo-router";
import { ChargeDetailScreen } from "@/components/charge-detail-screen";
export default function ChargeRoute() { const { id } = useLocalSearchParams<{ id: string }>(); return <ChargeDetailScreen id={id} />; }
