import { useLocalSearchParams, useRouter } from "expo-router";
import { PeopleScreen } from "@/components/screens/people-screen";

export default function PeopleRoute() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  // The billing form parked a draft before sending the user here, so the trip
  // has to survive one more hop: the form screen is the one that fills it in.
  const toBilling = returnTo === "new-billing";

  return (
    <PeopleScreen
      onOpenLedger={(id) => router.push({ pathname: "/people/[id]", params: { id } })}
      onNewContact={() => router.push(toBilling ? "/people/new?returnTo=new-billing" : "/people/new")}
    />
  );
}
