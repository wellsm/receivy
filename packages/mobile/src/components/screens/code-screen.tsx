import { useEffect, useState } from "react";
import { Image } from "expo-image";
import { formatRemaining, LOGIN_CODE_TTL_MS, maskEmail, RESEND_COOLDOWN_MS } from "@receivy/common";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { authClient } from "@/auth/client";
import { CODE_LENGTH, CodeBoxes } from "@/components/ui/code-boxes";

type Client = Pick<typeof authClient, "confirmEmailCode" | "requestEmailCode">;

type CodeScreenProps = {
  client?: Client;
  email: string;
  /** Instant the current code was sent; drives the expiry countdown. */
  sentAt?: number;
  onAuthenticated: () => void;
  now?: () => number;
};

const shieldMark = require("../../../assets/images/auth/shield.svg");
const lockMark = require("../../../assets/images/auth/lock.svg");

function useClock(now: () => number, running: boolean): number {
  const [tick, setTick] = useState(now);

  useEffect(() => {
    if (!running) {
      return;
    }

    const interval = setInterval(() => setTick(now()), 1000);

    return () => clearInterval(interval);
  }, [now, running]);

  return tick;
}

export function CodeScreen({ client = authClient, email, sentAt, onAuthenticated, now = Date.now }: CodeScreenProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedAt, setIssuedAt] = useState(() => sentAt ?? now());
  const [lastRequestAt, setLastRequestAt] = useState(() => sentAt ?? now());
  const [notice, setNotice] = useState<string | null>(null);

  const expiresAt = issuedAt + LOGIN_CODE_TTL_MS;
  const cooldownUntil = lastRequestAt + RESEND_COOLDOWN_MS;
  const clock = useClock(now, true);
  const remaining = expiresAt - clock;
  const expired = remaining <= 0;
  const cooldown = cooldownUntil - clock;
  const canResend = !busy && cooldown <= 0;
  const canConfirm = !busy && !expired && code.length === CODE_LENGTH;

  async function submit() {
    if (!canConfirm) {
      return;
    }

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
    if (!canResend) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await client.requestEmailCode({ email });

      const instant = now();

      setIssuedAt(instant);
      setLastRequestAt(instant);
      setCode("");
      setNotice("Enviamos um novo código.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar o código agora.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView className="flex-1" contentContainerClassName="flex-grow px-5 pb-8 pt-10" keyboardShouldPersistTaps="handled">
          <View className="items-center">
            <View className="h-20 w-20 items-center justify-center rounded-3xl bg-primary-soft/40">
              <Image source={shieldMark} style={{ width: 36, height: 36 }} />
            </View>
            <Text accessibilityRole="header" className="mt-6 text-center text-3xl font-extrabold tracking-tight text-primary-strong">
              Digite o código de 6 dígitos
            </Text>
            <Text className="mt-3 px-6 text-center text-base leading-6 text-muted">Enviamos um código de segurança temporário para</Text>
            <Text className="text-center text-base font-bold text-ink">{maskEmail(email)}</Text>
          </View>

          <Text className="mb-3 mt-8 text-center text-sm font-semibold text-ink">Código de Verificação</Text>
          <CodeBoxes value={code} onChange={setCode} onSubmit={() => void submit()} disabled={busy || expired} />

          <View className="mt-3 flex-row items-center gap-2">
            <Image source={lockMark} style={{ width: 16, height: 16 }} />
            {expired ? (
              <Text className="text-sm font-semibold text-red-700">Código expirado. Peça um novo código.</Text>
            ) : (
              <Text className="text-sm text-muted">
                Expira em <Text className="font-extrabold text-ink">{formatRemaining(remaining)}</Text>
              </Text>
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Confirmar e Entrar"
            accessibilityState={{ disabled: !canConfirm }}
            disabled={!canConfirm}
            onPress={() => void submit()}
            className="mt-6 h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary active:opacity-80 disabled:opacity-50"
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Text className="text-base font-extrabold text-white">Confirmar e Entrar</Text>
                <Text className="text-xl font-extrabold text-white">→</Text>
              </>
            )}
          </Pressable>

          {error && (
            <Text accessibilityRole="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm leading-5 text-red-700">
              {error}
            </Text>
          )}
          {notice && !error && (
            <Text accessibilityLiveRegion="polite" className="mt-4 text-center text-sm text-primary">
              {notice}
            </Text>
          )}

          <View className="mt-8 border-t border-outline/50 pt-6">
            <Text className="text-center text-base font-semibold text-ink">Não recebeu o código?</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reenviar código"
              accessibilityState={{ disabled: !canResend }}
              disabled={!canResend}
              onPress={() => void resend()}
              className="mt-2 min-h-12 flex-row items-center justify-center gap-2 disabled:opacity-50"
            >
              <Text className="text-lg text-primary">↻</Text>
              <Text className="text-base font-bold text-primary">
                {cooldown > 0 ? `Reenviar em ${formatRemaining(cooldown)}` : "Reenviar código"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
