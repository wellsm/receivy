import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { authClient } from "@/auth/client";
import { AuthBrand } from "./auth-brand";

type Client = Pick<typeof authClient, "confirmEmailCode" | "requestEmailCode">;

type CodeScreenProps = {
  client?: Client;
  email: string;
  onAuthenticated: () => void;
};

export function CodeScreen({ client = authClient, email, onAuthenticated }: CodeScreenProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await client.confirmEmailCode({ email, code });
      onAuthenticated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar agora.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await client.requestEmailCode({ email });
      setCode("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar o código agora.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas px-6 pb-8 pt-5">
      <AuthBrand />
      <KeyboardAvoidingView
        className="flex-1 justify-center"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="rounded-3xl border border-outline/60 bg-surface p-6">
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft">
            <Text className="text-2xl text-primary-strong">⌁</Text>
          </View>
          <Text className="mt-6 text-3xl font-extrabold tracking-tight text-primary-strong">
            Confira seu e-mail
          </Text>
          <Text className="mt-3 text-sm leading-6 text-muted">
            Enviamos um código para {email}.
          </Text>

          <Text className="mb-2 mt-7 text-sm font-bold text-ink">Código de 6 dígitos</Text>
          <TextInput
            accessibilityLabel="Código de 6 dígitos"
            autoComplete="one-time-code"
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, ""))}
            placeholder="000000"
            placeholderTextColor="#A3AAA7"
            className="h-16 rounded-2xl border border-outline bg-canvas px-4 text-center text-2xl font-extrabold tracking-[10px] text-ink"
          />
          <Pressable
            accessibilityLabel="Entrar"
            accessibilityRole="button"
            disabled={busy || code.length !== 6}
            onPress={() => void submit()}
            className="mt-4 h-14 items-center justify-center rounded-2xl bg-primary active:opacity-80 disabled:opacity-50"
          >
            {busy ? <ActivityIndicator color="white" /> : (
              <Text className="text-base font-extrabold text-white">Entrar  →</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void resend()}
            className="mt-2 h-12 items-center justify-center"
          >
            <Text className="text-sm font-bold text-primary">Enviar outro código</Text>
          </Pressable>
          {error && (
            <Text accessibilityRole="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm leading-5 text-red-700">
              {error}
            </Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
