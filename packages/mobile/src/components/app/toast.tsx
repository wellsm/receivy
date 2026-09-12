import { useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";

type ToastProps = {
  message: string;
  onDismiss: () => void;
  duration?: number;
};

/** Floating confirmation pinned to the bottom of the screen; goes away on its own or on tap. */
export function Toast({ message, onDismiss, duration = 3000 }: ToastProps) {
  // Screens pass inline arrows; keep the latest one without restarting the timer on every render.
  const dismiss = useRef(onDismiss);

  useEffect(() => {
    dismiss.current = onDismiss;
  });

  useEffect(() => {
    const timer = setTimeout(() => dismiss.current(), duration);

    return () => clearTimeout(timer);
  }, [message, duration]);

  return (
    <View pointerEvents="box-none" className="absolute inset-x-0 bottom-6 items-center px-4">
      <Pressable onPress={onDismiss} className="rounded-xl bg-ink px-4 py-3 shadow-lg">
        <Text role="status" className="text-sm font-semibold text-white">
          {message}
        </Text>
      </Pressable>
    </View>
  );
}
