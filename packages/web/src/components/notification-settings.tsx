"use client";
import { useCallback, useEffect, useState } from "react";
import type {
  NotificationDevice,
  NotificationPreferences,
} from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

export function NotificationSettings() {
  const [preferences, setPreferences] = useState<NotificationPreferences>();
  const [devices, setDevices] = useState<NotificationDevice[]>([]);
  const [offsets, setOffsets] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const [prefs, tokens] = await Promise.all([
        browserFetch("/api/financial/notification-preferences"),
        browserFetch("/api/financial/devices"),
      ]);
      if (!prefs.ok || !tokens.ok)
        throw new Error("Não foi possível carregar notificações.");
      const value = (await prefs.json()) as NotificationPreferences;
      setPreferences(value);
      setOffsets(value.reminderOffsets.join(", "));
      setDevices(
        ((await tokens.json()) as { devices: NotificationDevice[] }).devices,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Serviço indisponível.",
      );
    }
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([
      browserFetch("/api/financial/notification-preferences"),
      browserFetch("/api/financial/devices"),
    ])
      .then(async ([prefs, tokens]) => {
        if (!prefs.ok || !tokens.ok)
          throw new Error("Não foi possível carregar notificações.");
        const value = (await prefs.json()) as NotificationPreferences;
        const page = (await tokens.json()) as { devices: NotificationDevice[] };
        if (active) {
          setPreferences(value);
          setOffsets(value.reminderOffsets.join(", "));
          setDevices(page.devices);
        }
      })
      .catch(() => {
        if (active) setError("Não foi possível carregar notificações.");
      });
    return () => {
      active = false;
    };
  }, []);
  async function save() {
    if (!preferences) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const parts = offsets.trim()
        ? offsets.split(",").map((x) => x.trim())
        : [];
      if (parts.some((x) => !/^-?\d+$/.test(x)))
        throw new Error(
          "Use dias inteiros separados por vírgulas, como -3, 0, 2.",
        );
      const response = await browserFetch(
        "/api/financial/notification-preferences",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...preferences,
            reminderOffsets: parts.map(Number),
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          await responseMessage(response, "Não foi possível salvar."),
        );
      setPreferences(await response.json());
      setNotice("Preferências salvas.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await browserFetch(`/api/financial/devices/${id}`, {
        method: "DELETE",
      });
      if (!response.ok)
        throw new Error("Não foi possível remover o dispositivo.");
      setDevices((items) =>
        items.map((item) =>
          item.id === id ? { ...item, active: false } : item,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao remover.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="financial-page detail-section">
      <h2>Notificações</h2>
      <p>
        Push nos dispositivos ativos, com e-mail quando não há push disponível.
        A entrega depende dos serviços configurados.
      </p>
      {preferences ? (
        <>
          <label>
            <input
              type="checkbox"
              checked={preferences.emailEnabled}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  emailEnabled: event.target.checked,
                })
              }
            />{" "}
            Receber e-mail
          </label>
          <label>
            <input
              type="checkbox"
              checked={preferences.pushEnabled}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  pushEnabled: event.target.checked,
                })
              }
            />{" "}
            Receber push
          </label>
          <label>
            Dias dos lembretes padrão
            <input
              value={offsets}
              onChange={(event) => setOffsets(event.target.value)}
              placeholder="-3, 0, 2"
            />
          </label>
          <p>
            Valem como padrão para novas cobranças. Negativo: antes do
            vencimento; zero: no dia; positivo: depois. Vazio desativa
            lembretes padrão. Cada cobrança pode sobrescrever esses dias nos
            próprios lembretes.
          </p>
          <button
            disabled={busy}
            className="primary-button"
            onClick={() => void save()}
          >
            Salvar notificações
          </button>
        </>
      ) : (
        !error && <p role="status">Carregando notificações…</p>
      )}
      <h3>Dispositivos</h3>
      <p>
        Ative push pelo aplicativo móvel. Aqui você pode remover dispositivos
        registrados.
      </p>
      {devices.map((device) => (
        <div key={device.id} className="action-row">
          <span>
            {device.platform}
            {!device.active && " (inativo)"}
          </span>
          <button
            disabled={busy}
            aria-label={`Remover ${device.platform}`}
            onClick={() => void remove(device.id)}
          >
            Remover
          </button>
        </div>
      ))}
      {error && (
        <>
          <p role="alert" className="login-error">
            {error}
          </p>
          {!preferences && (
            <button onClick={() => void load()}>Tentar novamente</button>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
