"use client";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { PaymentMethod, PaymentMethodsPage, PixKeyType } from "@receivy/common";
import { useRouter } from "next/navigation";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { patchDraft } from "@/lib/billing-draft";
import { responseMessage } from "@/lib/financial-response";

const labels: Record<PixKeyType, string> = { cpf: "CPF", cnpj: "CNPJ", email: "E-mail", phone: "Telefone", random: "Chave aleatória" };
export function PixSettingsScreen({ returnTo, required = false }: { returnTo?: string; required?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<PaymentMethod[]>([]); const [type, setType] = useState<PixKeyType>("email"); const [key, setKey] = useState(""); const [label, setLabel] = useState(""); const [editing, setEditing] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [accountEmail, setAccountEmail] = useState(""); const [touched, setTouched] = useState(false);
  const load = useCallback(async () => { const response = await browserFetch("/api/financial/payment-methods"); if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível carregar suas chaves Pix.")); setItems((await response.json() as PaymentMethodsPage).paymentMethods); }, []);
  useEffect(() => { void browserFetch("/api/financial/payment-methods").then(async response => {
    if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível carregar suas chaves Pix.")); return response.json() as Promise<PaymentMethodsPage>;
  }).then(page => setItems(page.paymentMethods)).catch(reason => setError(reason instanceof Error ? reason.message : "Não foi possível carregar suas chaves Pix.")); }, []);

  useEffect(() => {
    let live = true;

    void browserFetch("/api/auth/me")
      .then(response => (response.ok ? (response.json() as Promise<{ user: { email: string | null } }>) : null))
      .then(payload => {
        if (live && payload?.user?.email) setAccountEmail(payload.user.email);
      })
      .catch(() => undefined);

    return () => { live = false; };
  }, []);

  // Most people register their own e-mail as the Pix key, so an untouched e-mail
  // field shows the account e-mail. It stays a normal editable field: typing —
  // or clearing it — takes over, and picking another type starts over.
  const pixKey = type === "email" && !key && !touched ? accountEmail : key;

  async function request(path: string, method: string, body?: object) { setBusy(true); setError(""); setNotice(""); try { const response = await browserFetch(`/api/financial/payment-methods${path}`, { method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) }); if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível salvar a chave Pix.")); const saved = response.status === 204 ? true : await response.json() as PaymentMethod; await load(); setNotice("Chaves Pix atualizadas."); return saved; } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a chave Pix."); return null; } finally { setBusy(false); } }
  async function save(event: FormEvent) {
    event.preventDefault();
    const saved = await request(editing ? `/${editing}` : "", editing ? "PATCH" : "POST", { pixKeyType: type, pixKey, label: label || undefined });
    if (!saved) return;
    setEditing(null); setKey(""); setLabel(""); setTouched(false);
    // Came from the billing form: hand the new key back to the draft.
    if (!returnTo) return;
    if (saved !== true) patchDraft({ pix: saved.id });
    router.push(returnTo);
  }
  return <section className="financial-page"><header><p className="date-line">Perfil</p><h1>Suas chaves Pix</h1><p>O Receivy apenas exibe a chave nos links. O pagamento acontece no banco.</p></header>{required && <p className="pix-required-notice" role="status">Você precisa de uma chave Pix para criar cobranças.</p>}<div className="settings-layout"><form className="creation-form compact" onSubmit={save}><h2>{editing ? "Editar chave" : "Adicionar chave"}</h2><label htmlFor="key-type">Tipo</label><select id="key-type" value={type} onChange={event => { setType(event.target.value as PixKeyType); setTouched(false); }}>{Object.entries(labels).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select><label htmlFor="pix-key">Chave Pix</label><input id="pix-key" required maxLength={254} value={pixKey} onChange={event => { setTouched(true); setKey(event.target.value); }} /><label htmlFor="pix-label">Nome para identificar</label><input id="pix-label" maxLength={120} value={label} onChange={event => setLabel(event.target.value)} /><button className="primary-button" disabled={busy}>Salvar chave</button></form><div className="method-list"><h2>Chaves cadastradas</h2>{!items.length && <p>Nenhuma chave Pix cadastrada.</p>}{items.map(item => <article key={item.id}><div><strong>{item.label || labels[item.pixKeyType]}</strong><code>{item.pixKey}</code>{item.isDefault && <span className="direction-badge receivable">Principal</span>}</div><div className="action-row"><button onClick={() => { setEditing(item.id); setType(item.pixKeyType); setKey(item.pixKey); setLabel(item.label); }}>Editar</button>{!item.isDefault && <button disabled={busy} onClick={() => void request(`/${item.id}/default`, "POST")}>Tornar principal</button>}<button disabled={busy} onClick={() => void request(`/${item.id}/archive`, "POST")}>Arquivar</button></div></article>)}</div></div>{error && <p role="alert" className="login-error">{error}</p>}{notice && <p role="status">{notice}</p>}</section>;
}
