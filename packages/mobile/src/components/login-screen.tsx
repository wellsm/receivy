import { useEffect, useState } from "react";
import { router } from "expo-router";
import * as AppleAuthentication from "expo-apple-authentication";
import { Image } from "expo-image";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "@/components/safe-area-view";
import { authClient } from "@/auth/client";
import { loginWithProvider } from "@/auth/oauth";
import { LegalSheet, type LegalKind } from "./legal-sheet";

type Client = Pick<typeof authClient, "requestEmailCode">;

type LoginScreenProps = {
  client?: Client;
  onCodeRequested: (email: string) => void;
};

const googleMark = require("../../assets/images/auth/google-g.svg");
const appleMark = require("../../assets/images/auth/apple-logo.svg");
const mailMark = require("../../assets/images/auth/mail.svg");

export function LoginScreen({ client = authClient, onCodeRequested }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState({ google: false, apple: false });
  const [nativeAppleAvailable, setNativeAppleAvailable] = useState(false);
  const [legal, setLegal] = useState<LegalKind | null>(null);

  useEffect(() => {
    void authClient
      .oauthProviders()
      .then((result) => setProviders({ google: result.google, apple: Platform.OS === "ios" ? result.appleNative : result.apple }))
      .catch(() => {});

    if (Platform.OS !== "ios") {
      return;
    }

    void AppleAuthentication.isAvailableAsync()
      .then(setNativeAppleAvailable)
      .catch(() => setNativeAppleAvailable(false));
  }, []);

  async function socialLogin(provider: "google" | "apple") {
    setBusy(true);
    setError(null);

    try {
      if (await loginWithProvider(provider)) {
        router.replace("/");
      }
    } catch {
      setError("Não foi possível concluir o login. Tente novamente ou use seu e-mail.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const normalizedEmail = email.normalize("NFC").trim().toLowerCase();

    if (!normalizedEmail) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await client.requestEmailCode({ email: normalizedEmail });
      onCodeRequested(normalizedEmail);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar o código agora.");
    } finally {
      setBusy(false);
    }
  }

  const showNativeApple = Platform.OS === "ios" && nativeAppleAvailable && providers.apple;
  const canSubmit = !busy && email.trim().length > 0;

  return (
    <SafeAreaView className="flex-1 bg-canvas">
      <View pointerEvents="none" className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-48 rounded-full bg-primary-soft/15" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow justify-between px-5 pb-6 pt-12"
          keyboardShouldPersistTaps="handled"
        >
          <View className="items-center">
            <View
              accessible={false}
              className="h-24 w-24 items-center justify-center rounded-3xl bg-primary"
              style={{ shadowColor: "#003828", shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 }}
            >
              <Text className="text-5xl font-extrabold text-white">R</Text>
            </View>
            <Text accessibilityRole="header" className="mt-5 text-4xl font-extrabold tracking-tight text-primary-strong">
              Receivy
            </Text>
            <Text className="mt-2 text-base text-muted">Controle o que tem a receber e a pagar</Text>
          </View>

          <View className="mt-8 gap-3 rounded-3xl border border-outline/60 bg-surface p-5">
            {providers.google && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continuar com Google"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => void socialLogin("google")}
                className="h-14 flex-row items-center justify-center gap-3 rounded-2xl border border-outline bg-surface disabled:opacity-40"
              >
                <Image source={googleMark} style={{ width: 22, height: 22 }} />
                <Text className="text-base font-bold text-ink">Continuar com Google</Text>
              </Pressable>
            )}

            {!providers.apple ? null : showNativeApple ? (
              <View pointerEvents={busy ? "none" : "auto"}>
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={16}
                  style={{ height: 56, width: "100%" }}
                  onPress={() => void socialLogin("apple")}
                />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continuar com Apple"
                accessibilityState={{ disabled: busy || Platform.OS === "ios" }}
                disabled={busy || Platform.OS === "ios"}
                onPress={() => void socialLogin("apple")}
                className="h-14 flex-row items-center justify-center gap-3 rounded-2xl bg-black disabled:opacity-40"
              >
                <Image source={appleMark} style={{ width: 20, height: 20 }} />
                <Text className="text-base font-bold text-white">Continuar com Apple</Text>
              </Pressable>
            )}

            {(providers.google || providers.apple) && (
              <View className="my-2 flex-row items-center gap-3">
                <View className="h-px flex-1 bg-outline/60" />
                <Text className="text-xs text-muted">ou continue com seu e-mail</Text>
                <View className="h-px flex-1 bg-outline/60" />
              </View>
            )}

            <View className="h-14 flex-row items-center gap-3 rounded-2xl border border-outline bg-canvas px-4">
              <Image source={mailMark} style={{ width: 20, height: 20 }} />
              <TextInput
                accessibilityLabel="Seu e-mail"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="go"
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={() => void submit()}
                placeholder="seu.email@exemplo.com"
                placeholderTextColor="#7D8794"
                className="flex-1 text-base tracking-normal text-ink"
              />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continuar com E-mail"
              accessibilityState={{ disabled: !canSubmit }}
              disabled={!canSubmit}
              onPress={() => void submit()}
              className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary active:opacity-80 disabled:opacity-50"
            >
              {busy ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Text className="text-base font-extrabold text-white">Continuar com E-mail</Text>
                  <Text className="text-xl font-extrabold text-white">→</Text>
                </>
              )}
            </Pressable>

            {error && (
              <Text accessibilityRole="alert" className="rounded-xl bg-red-50 p-3 text-sm leading-5 text-red-700">
                {error}
              </Text>
            )}
          </View>

          <Text className="mt-8 text-center text-xs leading-5 text-muted">
            Ao continuar, você concorda com os{" "}
            <Text accessibilityRole="link" onPress={() => setLegal("terms")} className="font-bold text-primary underline">
              Termos
            </Text>{" "}
            e a{" "}
            <Text accessibilityRole="link" onPress={() => setLegal("privacy")} className="font-bold text-primary underline">
              Privacidade
            </Text>
            .
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
      <LegalSheet kind={legal} onClose={() => setLegal(null)} />
    </SafeAreaView>
  );
}
