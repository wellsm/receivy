"use client";
import { useEffect, useState } from "react";
import { PixKeyType, type PaymentMethod } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

const FIELD = "min-h-12 rounded-xl border border-outline/50 bg-surface px-3 text-sm text-ink";
const LABEL = "text-xs font-semibold text-muted";

export function FirstSharePix({ busy, publish }: { busy: boolean; publish: (id: string) => Promise<void> }) {
  const [items, setItems] = useState<PaymentMethod[]>([]), [selected, setSelected] = useState("");
  const [key, setKey] = useState(""), [type, setType] = useState<PixKeyType>(PixKeyType.Email), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  useEffect(() => { void browserFetch("/api/financial/payment-methods").then(async response => { if (!response.ok) throw new Error("Não foi possível carregar as chaves."); setItems((await response.json()).paymentMethods); }).catch(() => setError("Não foi possível carregar as chaves. Reabra a cobrança para tentar novamente.")); }, []);
  async function save() {
    setSaving(true); setError("");
    try { const response = await browserFetch("/api/financial/payment-methods", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pixKeyType: type, pixKey: key }) }); if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível salvar a chave.")); const method: PaymentMethod = await response.json(); setItems(previous => [...previous, method]); setSelected(method.id); setKey(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a chave."); } finally { setSaving(false); }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-outline/30 bg-surface p-4">
      <h2 className="m-0 text-base font-bold text-ink">Pix antes de compartilhar</h2>
      <p className="m-0 text-sm leading-5 text-muted">Você pode manter este registro sem Pix. Para publicar, escolha a chave que ficará fixa nesta cobrança. O aviso inicial aguardará essa escolha.</p>

      <div className="flex flex-col gap-1">
        <label htmlFor="publication-pix" className={LABEL}>
          Pix para esta cobrança
        </label>
        <select id="publication-pix" value={selected} onChange={event => setSelected(event.target.value)} className={FIELD}>
          <option value="">Selecione uma chave</option>
          {items.map(item => (
            <option key={item.id} value={item.id}>
              {item.pixKeyType.toUpperCase()} · {item.pixKey}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        disabled={busy || saving || !selected}
        onClick={() => void publish(selected)}
        className="min-h-12 rounded-xl bg-primary text-sm font-bold text-on-primary transition hover:bg-primary-strong disabled:opacity-50"
      >
        Publicar com este Pix
      </button>

      <details className="flex flex-col gap-3">
        <summary className="cursor-pointer font-semibold text-ink">Cadastrar uma chave Pix</summary>

        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="publication-type" className={LABEL}>
              Tipo da nova chave
            </label>
            <select id="publication-type" value={type} onChange={event => setType(event.target.value as PixKeyType)} className={FIELD}>
              {["cpf", "cnpj", "email", "phone", "random"].map(value => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="publication-key" className={LABEL}>
              Nova chave Pix
            </label>
            <input id="publication-key" value={key} maxLength={254} onChange={event => setKey(event.target.value)} className={FIELD} />
          </div>

          <button type="button" disabled={busy || saving || !key.trim()} onClick={() => void save()} className="min-h-12 font-bold text-primary disabled:opacity-50">
            Salvar nova chave
          </button>
        </div>
      </details>

      {error && (
        <p role="alert" className="m-0 rounded-xl bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
