"use client";
import { useState } from "react";
import type { NotificationDelivery } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
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
}: {
  id: string;
  canRemind: boolean;
}) {
  const [items, setItems] = useState<NotificationDelivery[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function action(remind: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await browserFetch(
        `/api/financial/charges/${id}/${remind ? "reminders" : "deliveries"}`,
        remind ? { method: "POST" } : undefined,
      );
      if (!response.ok)
        throw new Error(
          await responseMessage(
            response,
            "Não foi possível consultar notificações.",
          ),
        );
      if (remind)
        setMessage(
          "Lembrete solicitado. Isso não confirma a entrega. Aguarde 24 horas para solicitar outro.",
        );
      else {
        setItems(
          ((await response.json()) as { deliveries: NotificationDelivery[] })
            .deliveries,
        );
        setMessage("Histórico atualizado.");
      }
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Serviço indisponível.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="detail-section">
      <h2>Avisos da cobrança</h2>
      <div className="action-row">
        {canRemind && (
          <button disabled={busy} onClick={() => void action(true)}>
            Enviar lembrete
          </button>
        )}
        <button disabled={busy} onClick={() => void action(false)}>
          Consultar envios
        </button>
      </div>
      {items.map((item) => (
        <p key={item.id}>
          {item.channel} ·{" "}
          {item.template === "initial" ? "Aviso inicial" : "Lembrete"} ·{" "}
          {labels[item.state]} · tentativas: {item.attempts}
        </p>
      ))}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
