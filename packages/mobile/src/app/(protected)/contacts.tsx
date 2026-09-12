import { useLocalSearchParams, useRouter } from "expo-router";
import { ContactsScreen } from "@/components/screens/contacts-screen";

export default function ContactsRoute() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  // The billing form parked a draft before sending the user here, so the trip
  // has to survive one more hop: the form screen is the one that fills it in.
  const toBilling = returnTo === "new-billing";

  return (
    <ContactsScreen
      onOpenLedger={(id) => router.push({ pathname: "/contacts/[id]", params: { id } })}
      onNewContact={() => router.push(toBilling ? "/contacts/new?returnTo=new-billing" : "/contacts/new")}
    />
  );
}
