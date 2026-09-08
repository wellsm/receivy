import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/safe-area-view";
import { LegalText } from "./legal-text";

export type LegalKind = "terms" | "privacy";

type LegalSheetProps = {
  kind: LegalKind | null;
  onClose: () => void;
};

/** Full-screen reader for the legal texts, opened from the login footer links. */
export function LegalSheet({ kind, onClose }: LegalSheetProps) {
  return (
    <Modal animationType="slide" visible={kind !== null} onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-canvas">
        <View className="flex-row items-center justify-between px-5 py-3">
          <Text className="text-lg font-extrabold text-primary-strong">
            {kind === "privacy" ? "Privacidade" : "Termos de uso"}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={onClose} className="min-h-12 justify-center px-2">
            <Text className="font-bold text-primary">Fechar</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerClassName="px-5 pb-12">
          {kind && <LegalText kind={kind} />}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
