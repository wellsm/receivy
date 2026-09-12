import { useCallback, type ReactNode } from "react";
import { useFocusEffect, useNavigation } from "expo-router";

type TabHeader = {
  /** Back-button label of every screen pushed over the tabs: iOS reads the previous screen's title. */
  title: string;
  right?: ReactNode;
};

/**
 * The tabs share one native header, owned by the `(tabs)` entry of the protected stack.
 * Each tab hands over its title and right-side actions whenever it is focused or re-renders.
 */
export function useTabHeader({ title, right }: TabHeader) {
  const navigation = useNavigation();

  useFocusEffect(
    useCallback(() => {
      navigation.getParent()?.setOptions({ title, headerRight: right ? () => right : undefined });
    }, [navigation, right, title]),
  );
}
