import { useLocalSearchParams, useRouter } from "expo-router";
import { ChargeDetailScreen } from "@/components/screens/charge-detail-screen";

export default function ChargeRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return <ChargeDetailScreen id={id} onOpenProof={() => router.push({ pathname: "/charges/[id]/proof", params: { id } })} />;
}
