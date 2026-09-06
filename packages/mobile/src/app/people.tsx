import { useRouter } from "expo-router";
import { PeopleScreen } from "@/components/people-screen";

export default function PeopleRoute() {
  const router = useRouter();
  return <PeopleScreen onBack={() => router.replace("/")} />;
}
