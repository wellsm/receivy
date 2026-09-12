import { useLocalSearchParams, useRouter } from "expo-router";
import { ProofViewerScreen } from "@/components/screens/proof-viewer-screen";

export default function ProofRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return <ProofViewerScreen chargeId={id} onDone={() => router.back()} />;
}
