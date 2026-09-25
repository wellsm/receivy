import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Image } from "expo-image";
import { Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { chargeDateText, PlanTier, WhatsappInstanceState, WhatsappSender, type WhatsappInstanceView, type WhatsappSettings } from "@receivy/common";
import { accountClient, type AccountClient } from "@/account/client";
import { financialClient, type FinancialClient } from "@/financial/client";
import { CopyButton } from "@/components/ui/copy-button";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { whatsappEnabled } from "@/whatsapp-flag";

type Client = Pick<AccountClient, "whatsapp" | "whatsappInstance" | "connectWhatsapp" | "disconnectWhatsapp" | "setWhatsappSender" | "profile">;
type Plans = Pick<FinancialClient, "plan">;

type WhatsappScreenProps = {
  client?: Client;
  plans?: Plans;
};

const LOAD_ERROR = "Não foi possível carregar o WhatsApp.";
const SELECT_ERROR = "Não deu para trocar o remetente.";

export const POLL_MS = 5000;

const RISK_POINTS = [
  'Canal não oficial: seu WhatsApp fica ligado ao Receivy como um "dispositivo conectado".',
  "A Meta pode bloquear o seu número, e o Receivy não tem como reverter.",
  "Sem garantia de entrega e sem cota: a mensagem vai como texto simples.",
  "Se o celular desconectar, os lembretes por WhatsApp param até você conectar de novo. Você é avisado por push e e-mail.",
];

/** Compares only the fields a poll can change, so an unchanged tick never triggers a re-render. */
function sameInstance(a: WhatsappInstanceView | null, b: WhatsappInstanceView | null): boolean {
  if (a === b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return a.state === b.state && a.qr === b.qr && a.pairingCode === b.pairingCode && a.phone === b.phone;
}

/** `5511988887777` → `+55 11 9····-7777`; identical to the web `maskPhone`. */
export function maskPhone(phone: string | null): string {
  if (!phone) {
    return "seu número";
  }

  return `+${phone.slice(0, 2)} ${phone.slice(2, 4)} 9····-${phone.slice(-4)}`;
}

function QuotaBar({ used, limit }: { used: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0;

  return (
    <View className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
      <View className="h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} />
    </View>
  );
}

async function openWhatsapp() {
  try {
    await Linking.openURL("whatsapp://");
  } catch {
    // Nothing to react to when WhatsApp isn't installed; the steps below still guide the person.
  }
}

type OwnNumberCardProps = {
  settings: WhatsappSettings | null;
  client: Client;
  onChange: (settings: WhatsappSettings) => void;
  disabled: boolean;
};

function OwnNumberCard({ settings, client, onChange, disabled }: OwnNumberCardProps) {
  const instance = settings?.instance ?? null;
  const [accepted, setAccepted] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    client
      .profile()
      .then((profile) => {
        if (active) {
          setPhone(profile.phone ?? "");
        }
      })
      .catch(() => {
        // The connect flow simply starts with an empty phone.
      });

    return () => {
      active = false;
    };
  }, [client]);

  const patch = useCallback(
    (next: WhatsappInstanceView | null, forceSender?: WhatsappSender) => {
      if (!settings) {
        return;
      }

      // The API sets the sender on POST (create) and DELETE, never on GET; mirror only those two —
      // a poll (or a manual "Gerar novo" refresh) leaves whatever sender is already in `settings`.
      const sender = next === null ? WhatsappSender.Receivy : (forceSender ?? settings.sender);

      onChange({ ...settings, instance: next, sender });
    },
    [onChange, settings],
  );

  // `patch` is recreated on every poll (it closes over `settings`); keep the latest one in a ref so the
  // polling interval below is set up once per pending run instead of being torn down on every tick.
  const patchRef = useRef(patch);

  // The latest instance, read by the poll handler below to skip a tick that changed nothing — an
  // identical poll result would otherwise still call `onChange`, causing a needless re-render (and,
  // under fake timers in tests, an act() warning for an update no one can observe).
  const instanceRef = useRef(instance);

  useEffect(() => {
    patchRef.current = patch;
    instanceRef.current = instance;
  });

  // Bumped by every user action (connect/refresh/disconnect/reconnect) and by the poll effect's own
  // cleanup, so a poll answered after the user has already moved on gets ignored instead of patching
  // stale state back in (e.g. a slow poll resolving after "Cancelar" already deleted the instance).
  const seqRef = useRef(0);

  // Guards a second press while an action is already in flight; kept as a ref (not just the `busy`
  // state) so the check is correct even before React has flushed the re-render that disables the button.
  const busyRef = useRef(false);

  // Poll while pending; the interval dies with the card or when the state moves on.
  useEffect(() => {
    if (instance?.state !== WhatsappInstanceState.Pending) {
      return;
    }

    let cancelled = false;

    const timer = setInterval(() => {
      const seq = seqRef.current;

      client
        .whatsappInstance()
        .then((next) => {
          if (cancelled || seqRef.current !== seq || sameInstance(next, instanceRef.current)) {
            return;
          }

          patchRef.current(next);
        })
        .catch(() => {
          // A failed poll is just the next tick's problem.
        });
    }, POLL_MS);

    return () => {
      cancelled = true;
      seqRef.current += 1;
      clearInterval(timer);
    };
  }, [client, instance?.state]);

  async function run<T>(action: () => Promise<T>, fallback: string): Promise<T | undefined> {
    if (busyRef.current) {
      return undefined;
    }

    busyRef.current = true;
    setBusy(true);
    setError("");

    try {
      return await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);

      return undefined;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function connect() {
    seqRef.current += 1;

    const next = await run(() => client.connectWhatsapp({ riskAccepted: true, phone }), "Não deu para conectar agora.");

    if (next) {
      patch(next, WhatsappSender.Own);
    }
  }

  async function refresh() {
    seqRef.current += 1;

    const next = await run(() => client.whatsappInstance(true), "Não deu para gerar um novo código.");

    if (next) {
      patch(next);
    }
  }

  async function disconnect() {
    seqRef.current += 1;
    setConfirming(false);

    const done = await run(() => client.disconnectWhatsapp().then(() => true), "Não deu para desconectar agora.");

    if (done) {
      patch(null);
    }
  }

  async function reconnect() {
    seqRef.current += 1;

    const done = await run(() => client.disconnectWhatsapp().then(() => true), "Não deu para desconectar agora.");

    if (done) {
      setAccepted(true);
      patch(null);
    }
  }

  const alert = error ? (
    <Text accessibilityRole="alert" className="font-sans text-sm text-danger">
      {error}
    </Text>
  ) : null;

  let body: ReactNode;

  if (instance?.state === WhatsappInstanceState.Open) {
    body = (
      <>
        <Text className="font-sans text-sm text-ink">
          {`Conectado ao ${maskPhone(instance.phone)}`}
          {instance.connectedAt ? ` · desde ${chargeDateText(instance.connectedAt.slice(0, 10))}` : ""}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Desconectar"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => setConfirming(true)}
        >
          <Text className="font-sans text-sm text-danger underline">Desconectar</Text>
        </Pressable>

        {alert}

        <Modal transparent animationType="fade" visible={confirming} onRequestClose={() => setConfirming(false)}>
          <View className="flex-1 items-center justify-center bg-scrim px-6">
            <View className="w-full gap-4 rounded-3xl bg-surface p-6">
              <Text accessibilityRole="header" className="font-display text-xl font-bold text-ink">
                Desconectar seu número?
              </Text>

              <Text className="font-sans leading-5 text-muted">Os lembretes voltam a sair pelo número do Receivy.</Text>

              <View className="flex-row gap-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar"
                  onPress={() => setConfirming(false)}
                  className="min-h-12 flex-1 items-center justify-center rounded-2xl border border-outline"
                >
                  <Text className="font-sans font-bold text-muted">Cancelar</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirmar desconexão"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => void disconnect()}
                  className="min-h-12 flex-1 items-center justify-center rounded-2xl bg-danger-solid"
                >
                  <Text className="font-sans font-bold text-on-danger">Desconectar</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </>
    );
  } else if (instance?.state === WhatsappInstanceState.Closed) {
    body = (
      <>
        <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-danger">
          {`Seu número desconectou${instance.disconnectedAt ? ` em ${chargeDateText(instance.disconnectedAt.slice(0, 10))}` : ""}. Os lembretes por WhatsApp estão parados.`}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reconectar"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void reconnect()}
          className="min-h-11 items-center justify-center rounded-xl bg-primary px-4"
        >
          <Text className="font-sans text-sm font-semibold text-on-primary">Reconectar</Text>
        </Pressable>

        {alert}
      </>
    );
  } else if (instance?.state === WhatsappInstanceState.Pending) {
    body = (
      <>
        {instance.pairingCode ? (
          <>
            <Text className="font-mono text-3xl tracking-widest text-ink">{instance.pairingCode}</Text>
            <CopyButton value={instance.pairingCode} accessibilityLabel="Copiar código" />
            <Text className="font-sans text-xs text-muted">
              No celular: WhatsApp › Dispositivos conectados › Conectar dispositivo › Conectar com número de telefone.
            </Text>
          </>
        ) : instance.qr ? (
          <>
            <Image source={{ uri: instance.qr }} accessibilityLabel="QR code para conectar" style={{ width: 192, height: 192 }} />
            <Text className="font-sans text-xs text-muted">No celular: WhatsApp › Dispositivos conectados › Conectar dispositivo.</Text>
          </>
        ) : (
          <Text className="font-sans text-xs text-muted">Gerando código…</Text>
        )}

        <Text className="font-sans text-xs text-muted">Aguardando…</Text>

        <Pressable accessibilityRole="button" accessibilityLabel="Abrir o WhatsApp" onPress={() => void openWhatsapp()}>
          <Text className="font-sans text-sm font-semibold text-primary">Abrir o WhatsApp</Text>
        </Pressable>

        <View className="flex-row gap-4">
          <Pressable accessibilityRole="button" accessibilityLabel="Gerar novo" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void refresh()}>
            <Text className="font-sans text-sm text-primary underline">Gerar novo</Text>
          </Pressable>

          <Pressable accessibilityRole="button" accessibilityLabel="Cancelar" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void disconnect()}>
            <Text className="font-sans text-sm text-danger underline">Cancelar</Text>
          </Pressable>
        </View>

        {alert}
      </>
    );
  } else {
    const canConnect = accepted && phone.trim().length > 0 && !disabled && !busy;

    body = (
      <>
        <View className="gap-1">
          {RISK_POINTS.map((point) => (
            <Text key={point} className="font-sans text-xs text-muted">{`• ${point}`}</Text>
          ))}
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel="Entendo que este canal não é oficial e que meu número pode ser bloqueado pela Meta."
          accessibilityState={{ checked: accepted, disabled }}
          disabled={disabled}
          onPress={() => setAccepted(!accepted)}
          className="flex-row items-start gap-2"
        >
          <Text className="font-sans text-sm text-ink">Entendo que este canal não é oficial e que meu número pode ser bloqueado pela Meta.</Text>
        </Pressable>

        <TextInput
          accessibilityLabel="Telefone"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="(11) 99999-9999"
          textAlignVertical="center"
          className="h-11 rounded-xl border border-outline px-3 font-sans text-[16px] tracking-normal text-ink"
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Conectar"
          accessibilityState={{ disabled: !canConnect }}
          disabled={!canConnect}
          onPress={() => void connect()}
          className="min-h-11 items-center justify-center rounded-xl bg-primary px-4 disabled:opacity-50"
        >
          <Text className="font-sans text-sm font-semibold text-on-primary">Conectar</Text>
        </Pressable>

        {alert}
      </>
    );
  }

  return <View className="gap-3">{body}</View>;
}

type RadioCardProps = {
  value: WhatsappSender;
  selected: WhatsappSender;
  disabled: boolean;
  title: string;
  onSelect: (sender: WhatsappSender) => void;
  children: ReactNode;
};

/** The radio is the header only; the body is its sibling, so its controls stay reachable and a tap on it never selects. */
function RadioCard({ value, selected, disabled, title, onSelect, children }: RadioCardProps) {
  const checked = value === selected;

  return (
    <View className={`gap-2 rounded-2xl border p-4 ${checked ? "border-primary" : "border-outline"} ${disabled ? "opacity-60" : ""}`}>
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={title}
        accessibilityState={{ checked, disabled }}
        disabled={disabled}
        onPress={() => onSelect(value)}
        className="flex-row items-center gap-3"
      >
        <View className={`h-4 w-4 items-center justify-center rounded-full border ${checked ? "border-primary" : "border-outline"}`}>
          {checked ? <View className="h-2 w-2 rounded-full bg-primary" /> : null}
        </View>
        <Text className="font-sans text-[14.5px] font-semibold text-ink">{title}</Text>
      </Pressable>
      {children}
    </View>
  );
}

export function WhatsappScreen({ client = accountClient, plans = financialClient }: WhatsappScreenProps) {
  const [settings, setSettings] = useState<WhatsappSettings | null>(null);
  const [plan, setPlan] = useState<PlanTier | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    return Promise.all([client.whatsapp(), plans.plan()])
      .then(([loaded, summary]) => {
        setSettings(loaded);
        setPlan(summary.plan);
        setError("");
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : LOAD_ERROR);
      });
  }, [client, plans]);

  useEffect(() => {
    if (!whatsappEnabled()) {
      return;
    }

    void load();
  }, [load]);

  if (!whatsappEnabled()) {
    return null;
  }

  const free = plan === PlanTier.Free;
  const locked = free || busy || !settings;
  const senderValue = settings?.sender ?? WhatsappSender.Receivy;

  async function select(sender: WhatsappSender) {
    if (!settings || locked || sender === settings.sender) {
      return;
    }

    // Picking the own number without a pairing opens the connect flow instead; the API
    // switches the sender on its own once it opens.
    if (sender === WhatsappSender.Own && !settings.instance) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const next = await client.setWhatsappSender(sender);

      setSettings({ ...settings, sender: next });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : SELECT_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View className="gap-4 px-5 pt-4">
          {error ? (
            <Text accessibilityRole="alert" className="rounded-xl bg-danger-soft p-3 font-sans text-sm text-danger">
              {error}
            </Text>
          ) : null}

          {free ? (
            <View className="rounded-2xl border border-outline p-4">
              <Text className="font-sans text-sm text-muted">Lembretes por WhatsApp fazem parte do plano Básico.</Text>
              <Text className="mt-2 font-sans text-xs text-muted">Gerencie seu plano no site.</Text>
            </View>
          ) : null}

          <View accessibilityRole="radiogroup" accessibilityLabel="Enviar por" className="gap-3">
            <RadioCard value={WhatsappSender.Receivy} selected={senderValue} disabled={locked} title="Número do Receivy" onSelect={(sender) => void select(sender)}>
              {settings?.quota ? (
                <>
                  <Text className="font-sans text-sm text-ink">{`${settings.quota.used} de ${settings.quota.limit} mensagens neste ciclo`}</Text>
                  <QuotaBar used={settings.quota.used} limit={settings.quota.limit} />
                  <Text className="font-sans text-xs text-muted">
                    {settings.quota.cycleEnd ? `Renova em ${chargeDateText(settings.quota.cycleEnd.slice(0, 10))}` : "Renova todo mês"}
                  </Text>
                </>
              ) : null}
              <Text className="font-sans text-xs text-muted">Número oficial, mensagens com modelos aprovados pela Meta. Seus contatos precisam ter aceitado receber.</Text>
            </RadioCard>

            <RadioCard value={WhatsappSender.Own} selected={senderValue} disabled={locked} title="Meu número" onSelect={(sender) => void select(sender)}>
              <OwnNumberCard settings={settings} client={client} onChange={setSettings} disabled={locked} />
            </RadioCard>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
