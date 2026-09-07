import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { NotificationDelivery } from "@receivy/common";
import {
  notificationClient,
  type NotificationClient,
} from "@/notifications/client";
const labels: Record<NotificationDelivery["state"], string> = {
  pending: "Aguardando envio",
  sending: "Envio em andamento",
  accepted: "Aceito pelo serviço (entrega não confirmada)",
  delivered: "Recibo do serviço push confirmado",
  disabled: "Serviço de envio desativado",
  failed: "Falha — requer atenção",
  uncertain: "Resultado incerto — sem reenvio automático",
  suppressed: "Não enviado por estado, preferência ou canal indisponível",
};
export function NotificationPanel({
  id,
  canRemind,
  client = notificationClient,
}: {
  id: string;
  canRemind: boolean;
  client?: NotificationClient;
}) {
  const [items, setItems] = useState<NotificationDelivery[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function action(remind: boolean) {
    setBusy(true);
    setMessage("");
    try {
      if (remind) {
        await client.remind(id);
        setMessage(
          "Lembrete solicitado. Isso não confirma a entrega. Aguarde 24 horas para solicitar outro.",
        );
      } else {
        setItems((await client.deliveries(id)).deliveries);
        setMessage("Histórico atualizado.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Serviço indisponível.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View className="gap-3 rounded-3xl border border-outline bg-surface p-5">
      <Text className="text-xl font-bold text-primary-strong">
        Avisos da cobrança
      </Text>
      {canRemind && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void action(true)}
          className="min-h-12 justify-center"
        >
          <Text className="font-bold text-primary">Enviar lembrete</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void action(false)}
        className="min-h-12 justify-center"
      >
        <Text className="font-bold text-primary">Consultar envios</Text>
      </Pressable>
      {items.map((item) => (
        <Text key={item.id}>
          {item.channel} ·{" "}
          {item.template === "initial" ? "Aviso inicial" : "Lembrete"} ·{" "}
          {labels[item.state]} · tentativas: {item.attempts}
        </Text>
      ))}
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
    </View>
  );
}
