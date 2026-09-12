import { useRouter } from "expo-router";
import { BillingsScreen } from "@/components/screens/billings-screen";

export default function BillingsRoute() {
  const router = useRouter();

  return (
    <BillingsScreen
      onCreate={() => router.push("/billings/new")}
      onOpenBilling={(id) => router.push({ pathname: "/billings/[id]", params: { id } })}
      onOpenCharge={(id) => router.push({ pathname: "/charges/[id]", params: { id } })}
    />
  );
}
