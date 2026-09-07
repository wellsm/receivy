"use client";
import { useState } from "react";
import { normalizePerson, type Person } from "@receivy/common";
import Link from "next/link";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

export function PersonDetails({ person, changed }: { person: Person; changed: () => Promise<void> }) {
  const [name, setName] = useState(person.name), [email, setEmail] = useState(person.email ?? ""), [phone, setPhone] = useState(person.phone ?? "");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function save(archive = false) { setBusy(true); setMessage(""); try {
    const response = await browserFetch(`/api/people/${person.id}${archive ? "/archive" : ""}`, { method: archive ? "POST" : "PATCH", ...(!archive ? { headers: { "content-type": "application/json" }, body: JSON.stringify(normalizePerson({ name, email, phone })) } : {}) });
    if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível salvar o contato.")); await changed(); setMessage(archive ? "Contato arquivado; histórico preservado." : "Contato atualizado; cobranças antigas não foram alteradas.");
  } catch (error) { setMessage(error instanceof Error ? error.message : "Confira os dados."); } finally { setBusy(false); } }
  return <section className="detail-section"><h2>{person.name}</h2><p>{person.hasAccount ? "Com conta" : "Sem conta"}{person.archivedAt ? " · Arquivado" : ""}</p><form className="creation-form compact" onSubmit={event => { event.preventDefault(); void save(); }}><label>Nome<input value={name} maxLength={120} required disabled={!!person.archivedAt} onChange={event => setName(event.target.value)} /></label><label>E-mail<input value={email} maxLength={254} disabled={!!person.archivedAt} onChange={event => setEmail(event.target.value)} /></label><label>Telefone<input value={phone} maxLength={40} disabled={!!person.archivedAt} onChange={event => setPhone(event.target.value)} /></label>{!person.archivedAt && <><button disabled={busy}>Salvar contato</button><button type="button" disabled={busy} onClick={() => { if (window.confirm("Arquivar este contato? O histórico será preservado.")) void save(true); }}>Arquivar contato</button><Link href="/charges/new">Nova cobrança</Link></>}</form>{message && <p role="status">{message}</p>}</section>;
}
