"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { normalizePerson, type Person, type PeoplePage } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import Link from "next/link";

export function PeopleScreen() {
  const [people, setPeople] = useState<Person[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Person | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const version = useRef(0);
  const nameInput = useRef<HTMLInputElement>(null);

  const load = useCallback((after?: string) => {
    const requestVersion = ++version.current;
    const query = new URLSearchParams({ archived: String(archived), ...(after ? { cursor: after } : {}), ...(search ? { search } : {}) });
    return browserFetch(`/api/people?${query}`).then(async response => {
      if (!response.ok) throw new Error("Não foi possível carregar os contatos.");
      const data = await response.json() as PeoplePage;
      if (requestVersion !== version.current) return;
      setPeople(previous => after ? [...previous, ...data.people] : data.people);
      setCursor(data.nextCursor);
      setError("");
    }).catch(reason => {
      if (requestVersion === version.current) setError(reason instanceof Error ? reason.message : "Serviço indisponível.");
    }).finally(() => { if (requestVersion === version.current) setLoading(false); });
  }, [archived, search]);

  const invalidate = useCallback(() => { version.current++; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  function reload(after?: string) { setLoading(true); void load(after); }

  function reset() { setEditing(null); setName(""); setEmail(""); setPhone(""); }

  async function save(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    let input;
    try { input = normalizePerson({ name, email, phone }); }
    catch (reason) { setError((reason as Error).message); return; }
    setBusy(true);
    try {
      const response = await browserFetch(editing ? `/api/people/${editing.id}` : "/api/people", {
        method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error((await response.json()).message ?? "Não foi possível salvar.");
      reset(); setNotice("Contato salvo."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }

  async function archive(person: Person) {
    if (!window.confirm(`Arquivar ${person.name}? O histórico será preservado.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await browserFetch(`/api/people/${person.id}/archive`, { method: "POST" });
      if (!response.ok) throw new Error("Não foi possível arquivar o contato.");
      if (editing?.id === person.id) reset();
      setNotice("Contato arquivado. O histórico foi preservado."); await load();
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  return <section className="people-page">
    <p className="login-eyebrow">Sua agenda</p><h1>Quem faz parte das suas contas?</h1>
    <p className="people-intro">Cadastre pessoas para organizar suas cobranças. Elas não precisam ter uma conta no Receivy.</p>
    <div className="people-layout">
      <form className="people-editor login-form" onSubmit={save} aria-label={editing ? "Editar contato" : "Novo contato"}>
        <h2>{editing ? "Editar contato" : "Novo contato"}</h2>
        <label htmlFor="person-name">Nome</label><input ref={nameInput} id="person-name" maxLength={120} value={name} onChange={e => setName(e.target.value)} required autoComplete="name" />
        <label htmlFor="person-email">E-mail <span>(opcional)</span></label><input id="person-email" type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
        <label htmlFor="person-phone">Telefone com DDD <span>(opcional)</span></label><input id="person-phone" type="tel" maxLength={40} value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" />
        <p className="people-hint">O e-mail permite que a pessoa encontre as cobranças ao entrar na própria conta.</p>
        <button className="login-submit" disabled={busy} type="submit">{busy ? "Salvando…" : "Salvar contato"}</button>
        {editing && <button className="login-text-button" disabled={busy} type="button" onClick={reset}>Cancelar edição</button>}
      </form>
      <div className="people-agenda">
        <label htmlFor="people-search">Buscar contatos</label><input id="people-search" type="search" maxLength={254} value={search} onChange={event => { setLoading(true); setPeople([]); setCursor(null); setSearch(event.target.value); }} />
        <div className="people-list-heading"><h2>Contatos</h2><label><input type="checkbox" checked={archived} disabled={busy || loading} onChange={e => { setLoading(true); setPeople([]); setArchived(e.target.checked); reset(); }} /> Ver arquivados</label></div>
        {error && <p className="login-error" role="alert">{error} <button type="button" onClick={() => reload()} disabled={loading}>Tentar carregar novamente</button></p>}
        {notice && <p role="status">{notice}</p>}
        {loading && <p role="status">Carregando contatos…</p>}
        {!loading && !error && people.length === 0 && <div className="people-empty"><h3>{archived ? "Nenhum contato arquivado" : "Sua agenda começa com uma pessoa"}</h3><p>{archived ? "Os contatos arquivados aparecerão aqui." : "Pode ser alguém com quem você dividiu uma compra ou combinou um pagamento."}</p></div>}
        <ul className="people-list">{people.map(person => <li key={person.id}>
          <span className="person-avatar" aria-hidden="true">{person.name.slice(0, 1).toLocaleUpperCase("pt-BR")}</span>
          <div className="person-info"><strong>{person.name}</strong><span>{person.hasAccount ? "Com conta" : "Sem conta"}</span><span>{person.email ?? "Sem e-mail"}</span>{person.phone && <span>{person.phone}</span>}</div>
          <div className="person-actions"><Link href={`/people/${person.id}`}>Histórico<span className="visually-hidden"> de {person.name}</span></Link>{!person.archivedAt && <><button disabled={busy} onClick={() => { setEditing(person); setName(person.name); setEmail(person.email ?? ""); setPhone(person.phone ?? ""); nameInput.current?.focus(); }}>Editar<span className="visually-hidden"> {person.name}</span></button><button disabled={busy} onClick={() => void archive(person)}>Arquivar<span className="visually-hidden"> {person.name}</span></button></>}</div>
        </li>)}</ul>
        {cursor && <button className="login-text-button" disabled={loading || busy} onClick={() => reload(cursor)}>Carregar mais contatos</button>}
      </div>
    </div>
  </section>;
}
