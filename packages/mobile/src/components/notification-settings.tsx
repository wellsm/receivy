import { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import type {
  NotificationDevice,
  NotificationPreferences,
} from "@receivy/common";
import {
  notificationClient,
  type NotificationClient,
} from "@/notifications/client";
import { registerPushDevice } from "@/notifications/register";
export function NotificationSettings({
  client = notificationClient,
}: {
  client?: NotificationClient;
}) {
  const [preferences, setPreferences] = useState<NotificationPreferences>();
  const [devices, setDevices] = useState<NotificationDevice[]>([]);
  const [offsets, setOffsets] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const [prefs, page] = await Promise.all([
        client.preferences(),
        client.devices(),
      ]);
      setPreferences(prefs);
      setOffsets(prefs.reminderOffsets.join(", "));
      setDevices(page.devices);
    } catch {
      setMessage("Não foi possível carregar notificações.");
    }
  }, [client]);
  useEffect(() => {
    let active = true;
    void Promise.all([client.preferences(), client.devices()])
      .then(([prefs, page]) => {
        if (active) {
          setPreferences(prefs);
          setOffsets(prefs.reminderOffsets.join(", "));
          setDevices(page.devices);
        }
      })
      .catch(() => {
        if (active) setMessage("Não foi possível carregar notificações.");
      });
    return () => {
      active = false;
    };
  }, [client]);
  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Serviço indisponível.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!preferences) return;
    const parts = offsets.trim() ? offsets.split(",").map((x) => x.trim()) : [];
    if (parts.some((x) => !/^-?\d+$/.test(x)))
      throw new Error(
        "Use dias inteiros separados por vírgulas, como -3, 0, 2.",
      );
    setPreferences(
      await client.save({ ...preferences, reminderOffsets: parts.map(Number) }),
    );
  }
  return (
    <View className="gap-4 rounded-3xl border border-outline bg-surface p-5">
      <Text className="text-2xl font-bold text-primary-strong">
        Notificações
      </Text>
      <Text className="text-muted">
        Push nos dispositivos ativos; e-mail quando não há push disponível. A
        entrega depende dos serviços configurados.
      </Text>
      {preferences ? (
        <>
          <View className="flex-row items-center justify-between">
            <Text>Receber e-mail</Text>
            <Switch
              accessibilityLabel="Receber e-mail"
              value={preferences.emailEnabled}
              onValueChange={(value) =>
                setPreferences({ ...preferences, emailEnabled: value })
              }
            />
          </View>
          <View className="flex-row items-center justify-between">
            <Text>Receber push</Text>
            <Switch
              accessibilityLabel="Receber push"
              value={preferences.pushEnabled}
              onValueChange={(value) =>
                setPreferences({ ...preferences, pushEnabled: value })
              }
            />
          </View>
          <Text>Dias dos lembretes padrão</Text>
          <TextInput
            accessibilityLabel="Dias dos lembretes padrão"
            value={offsets}
            onChangeText={setOffsets}
            placeholder="-3, 0, 2"
            className="min-h-12 rounded-xl border border-outline px-3"
          />
          <Text className="text-muted">
            Novas cobranças avulsas: negativo antes, zero no dia, positivo
            depois. Vazio desativa. Recorrências têm configuração própria.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void perform(save, "Preferências salvas.")}
            className="min-h-12 items-center justify-center rounded-xl bg-primary"
          >
            <Text className="font-bold text-white">Salvar notificações</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => void load()}
          className="min-h-12 justify-center"
        >
          <Text>Carregar notificações</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() =>
          void perform(async () => {
            await registerPushDevice(client.register);
            setDevices((await client.devices()).devices);
          }, "Dispositivo registrado. Isso não confirma a entrega de push.")
        }
        className="min-h-12 justify-center"
      >
        <Text className="font-bold text-primary">
          Ativar push neste dispositivo
        </Text>
      </Pressable>
      {devices
        .filter((device) => device.active)
        .map((device) => (
          <View
            key={device.id}
            className="flex-row items-center justify-between"
          >
            <Text>{device.platform}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remover ${device.platform}`}
              disabled={busy}
              onPress={() =>
                void perform(async () => {
                  await client.remove(device.id);
                  setDevices((items) =>
                    items.map((item) =>
                      item.id === device.id ? { ...item, active: false } : item,
                    ),
                  );
                }, "Dispositivo removido.")
              }
              className="min-h-12 justify-center"
            >
              <Text className="text-red-700">Remover</Text>
            </Pressable>
          </View>
        ))}
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
    </View>
  );
}
