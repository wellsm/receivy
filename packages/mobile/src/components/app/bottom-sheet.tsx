import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

type BottomSheetProps = {
  title: string;
  /** Right-aligned note beside the title, such as "fecha R$ 53,90". */
  trailing?: ReactNode;
  /** The closing button label; absent hides it and the scrim is the only way out. */
  doneLabel?: string;
  children: ReactNode;
  onClose: () => void;
};

/** The panel that slides over the form: a handle, a title, its content and Pronto. */
export function BottomSheet({ title, trailing, doneLabel = "Pronto", children, onClose }: BottomSheetProps) {
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Fechar ${title}`} onPress={onClose} className="flex-1 bg-scrim" />

      <View className="max-h-[88%] rounded-t-3xl bg-canvas px-5 pb-8 pt-2.5">
        <View className="mb-3 h-1 w-9 self-center rounded-full bg-outline" />
        <View className="mb-3 flex-row items-center justify-between gap-3">
          <Text accessibilityRole="header" className="font-display text-xl font-bold text-ink">
            {title}
          </Text>
          {trailing}
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-3 pb-2" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>

        {doneLabel ? (
          <Pressable accessibilityRole="button" accessibilityLabel={doneLabel} onPress={onClose} className="mt-3 h-[52px] items-center justify-center rounded-2xl bg-ink">
            <Text className="font-sans text-[15px] font-bold text-surface">{doneLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}
