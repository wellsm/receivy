import { useLocalSearchParams, useRouter } from "expo-router";
import { PixSettingsScreen } from "@/components/screens/pix-settings-screen";

export default function PixSettingsRoute() {
  const router = useRouter();
  const { returnTo, required } = useLocalSearchParams<{ returnTo?: string; required?: string }>();
  // The billing form parked a draft before sending the user here; the key form
  // one hop down is the screen that fills it in, so the trip carries over.
  const toBilling = returnTo === "new-billing";
  const gated = required === "1";

  return (
    <PixSettingsScreen
      required={gated}
      onNewKey={() =>
        router.push({
          pathname: "/settings/pix/new",
          params: { ...(toBilling ? { returnTo: "new-billing" } : {}), ...(gated ? { required: "1" } : {}) },
        })
      }
    />
  );
}
