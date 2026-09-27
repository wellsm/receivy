import { useCallback } from "react";
import { useFocusEffect, useNavigation } from "expo-router";

/**
 * The tabs show no header, but the `(tabs)` entry of the protected stack still carries a title:
 * iOS labels the back button of every screen pushed over the tabs with it. Each tab hands its
 * own title over whenever it is focused.
 */
export function useTabHeader({ title }: { title: string }) {
  const navigation = useNavigation();

  useFocusEffect(
    useCallback(() => {
      navigation.getParent()?.setOptions({ title });
    }, [navigation, title]),
  );
}
