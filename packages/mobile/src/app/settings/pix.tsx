import { useLocalSearchParams, useRouter } from "expo-router";
import { PixSettingsScreen } from "@/components/pix-settings-screen";
import { patchDraft } from "@/financial/draft-store";

export default function PixSettingsRoute() {
  const router = useRouter();
  const { returnTo, required } = useLocalSearchParams<{ returnTo?: string; required?: string }>();
  const toBilling = returnTo === "new-billing";

  return (
    <PixSettingsScreen
      required={required === "1"}
      onCreated={
        toBilling
          ? (method) => {
              patchDraft({ pix: method.id });
              router.back();
            }
          : undefined
      }
    />
  );
}
