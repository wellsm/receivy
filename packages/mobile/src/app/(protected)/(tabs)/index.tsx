import { useRouter } from "expo-router";
import { FeedScreen } from "@/components/screens/feed-screen";

export default function FeedRoute() {
  const router = useRouter();

  return (
    <FeedScreen
      onOpenCharge={(id) => router.push({ pathname: "/charges/[id]", params: { id } })}
    />
  );
}
