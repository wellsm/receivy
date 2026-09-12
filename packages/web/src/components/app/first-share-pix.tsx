"use client";
import { useEffect, useState } from "react";
import type { PaymentMethod, PixKeyType } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

export function FirstSharePix({ busy, publish }: { busy: boolean; publish: (id: string) => Promise<void> }) {
  const [items, setItems] = useState<PaymentMethod[]>([]), [selected, setSelected] = useState("");
  const [key, setKey] = useState(""), [type, setType] = useState<PixKeyType>("email"), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  useEffect(() => { void browserFetch("/api/financial/payment-methods").then(async response => { if (!response.ok) throw new Error("Não foi possível carregar as chaves."); setItems((await response.json()).paymentMethods); }).catch(() => setError("Não foi possível carregar as chaves. Reabra a cobrança para tentar novamente.")); }, []);
  async function save() {
    setSaving(true); setError("");
    try { const response = await browserFetch("/api/financial/payment-methods", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pixKeyType: type, pixKey: key }) }); if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível salvar a chave.")); const method: PaymentMethod = await response.json(); setItems(previous => [...previous, method]); setSelected(method.id); setKey(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a chave."); } finally { setSaving(false); }
  }
  return <section className="detail-section"><h2>Pix antes de compartilhar</h2><p>Você pode manter este registro sem Pix. Para publicar, escolha a chave que ficará fixa nesta cobrança. O aviso inicial aguardará essa escolha.</p>
    <label htmlFor="publication-pix">Pix para esta cobrança</label><select id="publication-pix" value={selected} onChange={event => setSelected(event.target.value)}><option value="">Selecione uma chave</option>{items.map(item => <option key={item.id} value={item.id}>{item.label || item.pixKeyType} · {item.pixKey}</option>)}</select>
    <button disabled={busy || saving || !selected} onClick={() => void publish(selected)}>Publicar com este Pix</button>
    <details><summary>Cadastrar uma chave Pix</summary><label htmlFor="publication-type">Tipo da nova chave</label><select id="publication-type" value={type} onChange={event => setType(event.target.value as PixKeyType)}>{["cpf", "cnpj", "email", "phone", "random"].map(value => <option key={value}>{value}</option>)}</select><label htmlFor="publication-key">Nova chave Pix</label><input id="publication-key" value={key} maxLength={254} onChange={event => setKey(event.target.value)} /><button disabled={busy || saving || !key.trim()} onClick={() => void save()}>Salvar nova chave</button></details>
    {error && <p role="alert">{error}</p>}
  </section>;
}
