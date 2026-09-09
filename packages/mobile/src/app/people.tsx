import { useLocalSearchParams, useRouter } from "expo-router";
import { PeopleScreen } from "@/components/people-screen";
import { patchDraft } from "@/financial/draft-store";

export default function PeopleRoute() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const toBilling = returnTo === "new-billing";

  return (
    <PeopleScreen
      onBack={() => (toBilling ? router.back() : router.replace("/settings"))}
      onOpenLedger={id => router.push({ pathname: "/people/[id]", params: { id } })}
      onCreated={toBilling ? person => { patchDraft({ selected: [person.id] }); router.back(); } : undefined}
    />
  );
}
