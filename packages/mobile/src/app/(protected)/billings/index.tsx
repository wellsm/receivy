import { useRouter } from "expo-router";
import { BillingsScreen } from "@/components/screens/billings-screen";

export default function BillingsRoute() {
  const router = useRouter();

  return (
    <BillingsScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      onCreate={() => router.push("/billings/new")}
      onOpenBilling={(id) => router.push({ pathname: "/billings/[id]", params: { id } })}
      onOpenProfile={() => router.push("/settings")}
    />
  );
}
