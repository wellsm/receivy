import { useEffect, useState } from "react";
import { router } from "expo-router";
import { loginWithProvider } from "@/auth/oauth";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { authClient } from "@/auth/client";
import { AuthBrand } from "./auth-brand";

type Client = Pick<typeof authClient, "requestEmailCode">;

type LoginScreenProps = {
  client?: Client;
  onCodeRequested: (email: string) => void;
};

export function LoginScreen({ client = authClient, onCodeRequested }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState({ google: false, apple: false });

  useEffect(() => { void authClient.oauthProviders().then(setProviders); }, []);

  async function socialLogin(provider: "google" | "apple") {
    setBusy(true);
    setError(null);
    try {
      if (await loginWithProvider(provider)) router.replace("/");
    } catch {
      setError("Não foi possível concluir o login. Tente novamente ou use seu e-mail.");
    } finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const normalizedEmail = email.normalize("NFC").trim().toLowerCase();
    try {
      await client.requestEmailCode({ email: normalizedEmail });
      onCodeRequested(normalizedEmail);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar o código agora.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow justify-between px-6 pb-8 pt-5"
          keyboardShouldPersistTaps="handled"
        >
          <AuthBrand />

          <View className="my-10">
            <Text className="text-xs font-extrabold uppercase tracking-widest text-primary">
              Bem-vindo
            </Text>
            <Text className="mt-3 text-4xl font-extrabold leading-10 tracking-tight text-primary-strong">
              Entre no Receivy
            </Text>
            <Text className="mt-3 text-base leading-6 text-muted">
              Sem senha. Enviaremos um código de uso único para o seu e-mail.
            </Text>

            <View className="mt-8 gap-3">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy || !providers.google }}
                disabled={busy || !providers.google}
                onPress={() => void socialLogin("google")}
                className="h-13 items-center justify-center rounded-2xl border border-outline bg-surface opacity-50"
              >
                <Text className="font-bold text-ink">G  Continuar com Google</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy || !providers.apple }}
                disabled={busy || !providers.apple}
                onPress={() => void socialLogin("apple")}
                className="h-13 items-center justify-center rounded-2xl border border-outline bg-surface opacity-50"
              >
                <Text className="font-bold text-ink">●  Continuar com Apple</Text>
              </Pressable>
              <Text className="text-center text-xs leading-5 text-muted">
                {(!providers.google || !providers.apple) ? "Algumas opções de login estão temporariamente indisponíveis." : "Entre com sua conta Google ou Apple."}
              </Text>
            </View>

            <View className="my-7 flex-row items-center gap-3">
              <View className="h-px flex-1 bg-outline/60" />
              <Text className="text-[10px] font-bold uppercase tracking-widest text-muted">
                ou use seu e-mail
              </Text>
              <View className="h-px flex-1 bg-outline/60" />
            </View>

            <Text className="mb-2 text-sm font-bold text-ink">Seu e-mail</Text>
            <TextInput
              accessibilityLabel="Seu e-mail"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              placeholder="voce@exemplo.com"
              placeholderTextColor="#7D8794"
              className="h-14 rounded-2xl border border-outline bg-surface px-4 text-base text-ink"
            />
            <Pressable
              accessibilityLabel="Receber código"
              accessibilityRole="button"
              disabled={busy || !email.trim()}
              onPress={() => void submit()}
              className="mt-4 h-14 flex-row items-center justify-center rounded-2xl bg-primary active:opacity-80 disabled:opacity-50"
            >
              {busy ? <ActivityIndicator color="white" /> : (
                <Text className="text-base font-extrabold text-white">Receber código  →</Text>
              )}
            </Pressable>
            {error && (
              <Text accessibilityRole="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm leading-5 text-red-700">
                {error}
              </Text>
            )}
          </View>

          <Text className="text-center text-xs leading-5 text-muted">
            Use o mesmo e-mail em que recebeu uma cobrança para encontrá-la na sua timeline.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
