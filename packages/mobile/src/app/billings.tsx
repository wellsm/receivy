import { useRouter } from "expo-router";
import { BillingsScreen } from "@/components/billings-screen";

export default function BillingsRoute() {
  const router = useRouter();

  return (
    <BillingsScreen
      onCreate={() => router.push("/charges/new")}
      onOpenCharge={(id) => router.push({ pathname: "/charges/[id]", params: { id } })}
      onOpenFeed={() => router.replace("/")}
      onOpenSettings={() => router.push("/settings")}
    />
  );
}
