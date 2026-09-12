import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { formatPhoneBR, type AuthUser } from "@receivy/common";
import { accountClient, type AccountClient } from "@/account/client";
import { profileStore, type ProfileStore } from "@/account/profile";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { LegalText } from "@/components/ui/legal-text";

type LegalKind = "terms" | "privacy";

type OnboardingScreenProps = {
  client?: Pick<AccountClient, "save">;
  store?: Pick<ProfileStore, "load" | "remember">;
  onComplete: (user: AuthUser) => void;
};

export function OnboardingScreen({ client = accountClient, store = profileStore, onComplete }: OnboardingScreenProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legal, setLegal] = useState<LegalKind | null>(null);

  // An account created by someone's agenda already carries the name that person
  // typed, so the screen offers it instead of asking again from scratch.
  useEffect(() => {
    let live = true;

    void store
      .load()
      .then((user) => {
        if (!live) {
          return;
        }

        setName((current) => current || (user.name ?? ""));
        setPhone((current) => current || formatPhoneBR(user.phone ?? ""));
      })
      .catch(() => {});

    return () => {
      live = false;
    };
  }, [store]);

  const trimmedName = name.trim();
  const canContinue = !busy && trimmedName.length > 0;

  async function submit() {
    if (!canContinue) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const user = await client.save({
        name: trimmedName,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        locale: "pt-BR",
        country: "BR",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      store.remember(user);
      onComplete(user);
    } catch {
      setError("Não foi possível salvar seu nome. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  function toggleLegal(kind: LegalKind) {
    setLegal((current) => (current === kind ? null : kind));
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas px-6 pb-8" edges={["bottom"]}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow justify-center py-6"
          keyboardShouldPersistTaps="handled"
        >
          <View className="rounded-3xl border border-outline/60 bg-surface p-6">
            <Text className="text-xs font-extrabold uppercase tracking-widest text-primary">Antes de começar</Text>
            <Text className="mt-3 text-3xl font-extrabold leading-9 tracking-tight text-primary-strong">
              Como podemos chamar você?
            </Text>
            <Text className="mt-3 text-sm leading-6 text-muted">
              Esse nome aparece para quem recebe suas cobranças e lembretes.
            </Text>

            <Text className="mb-2 mt-7 text-sm font-bold text-ink">Nome</Text>
            <TextInput
              accessibilityLabel="Nome"
              autoComplete="name"
              autoFocus
              maxLength={120}
              onChangeText={setName}
              onSubmitEditing={() => void submit()}
              placeholder="Seu nome"
              placeholderTextColor="#7D8794"
              returnKeyType="done"
              textContentType="name"
              value={name}
              className="h-14 rounded-2xl border border-outline bg-white px-4 text-base tracking-normal text-ink"
            />

            <Text className="mb-2 mt-5 text-sm font-bold text-ink">Telefone</Text>
            <TextInput
              accessibilityLabel="Telefone (Opcional)"
              autoComplete="tel"
              keyboardType="phone-pad"
              maxLength={20}
              onChangeText={(value) => setPhone(formatPhoneBR(value))}
              onSubmitEditing={() => void submit()}
              placeholder="(11) 98765-4321"
              placeholderTextColor="#7D8794"
              returnKeyType="done"
              textContentType="telephoneNumber"
              value={phone}
              className="h-14 rounded-2xl border border-outline bg-white px-4 text-base tracking-normal text-ink"
            />

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canContinue }}
              disabled={!canContinue}
              onPress={() => void submit()}
              className="mt-4 h-14 items-center justify-center rounded-2xl bg-primary active:opacity-80 disabled:opacity-50"
            >
              {busy ? <ActivityIndicator color="white" /> : <Text className="text-base font-bold text-white">Continuar</Text>}
            </Pressable>

            {error && (
              <Text accessibilityRole="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm leading-5 text-red-700">
                {error}
              </Text>
            )}
          </View>

          <Text className="mt-6 text-center text-xs leading-5 text-muted">
            Ao continuar, você concorda com os{" "}
            <Text accessibilityRole="link" onPress={() => toggleLegal("terms")} className="font-bold text-primary">
              Termos de uso
            </Text>{" "}
            e a{" "}
            <Text accessibilityRole="link" onPress={() => toggleLegal("privacy")} className="font-bold text-primary">
              Privacidade
            </Text>
            .
          </Text>

          {legal && (
            <View className="mt-6">
              <LegalText kind={legal} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
