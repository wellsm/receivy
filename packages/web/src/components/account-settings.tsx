"use client";

import { useEffect, useState } from "react";
import type { AuthUser, AccountSession } from "@receivy/common";
import { ACCOUNT_DELETED, ACCOUNT_DELETION_UNCONFIRMED } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";

type LogoutContext = { action: "delete"; deleted: boolean } | { action: "revoke" };

export function AccountSettings() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(false);
  const [logoutRetry, setLogoutRetry] = useState<LogoutContext | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      browserFetch("/api/auth/me").then(r => r.ok ? r.json() : Promise.reject()),
      browserFetch("/api/financial/account/sessions").then(r => r.ok ? r.json() : Promise.reject()),
    ]).then(([profile, page]) => {
      if (!active) return;
      setUser(profile.user);
      setName(profile.user.name ?? "");
      setTimezone(profile.user.timezone);
      setSessions(page.sessions);
    }, () => active && setNotice("Não foi possível carregar sua conta."));
    return () => { active = false; };
  }, []);

  async function save() {
    setBusy(true);
    try {
      const response = await browserFetch("/api/financial/account/profile", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, timezone, locale: "pt-BR", country: "BR" }),
      });
      if (!response.ok) throw new Error();
      setUser((await response.json()).user);
      setNotice("Perfil salvo.");
    } catch {
      setNotice("Não foi possível salvar. Confira seu nome e fuso horário.");
    } finally { setBusy(false); }
  }

  async function finishLogout(context: LogoutContext) {
    let confirmed = false;
    try { confirmed = (await fetch("/api/auth/logout", { method: "POST" })).ok; } catch {}
    if (confirmed) {
      setEnded(true);
      setLogoutRetry(null);
      setNotice(context.action === "delete"
        ? (context.deleted ? ACCOUNT_DELETED : ACCOUNT_DELETION_UNCONFIRMED)
        : "Sessão encerrada.");
      return;
    }
    // A failed request cannot establish that the HttpOnly browser cookies were cleared.
    setLogoutRetry(context);
    if (context.action === "delete") {
      setEnded(context.deleted);
      setNotice(context.deleted
        ? ACCOUNT_DELETED + " Não foi possível encerrar a sessão deste navegador. Tente novamente."
        : "Não foi possível confirmar a exclusão nem encerrar a sessão. Conecte-se e tente novamente.");
    } else {
      setEnded(true);
      setNotice("Sessão revogada, mas não foi possível encerrar a sessão deste navegador. Tente novamente.");
    }
  }

  async function retryLogout() {
    if (!logoutRetry || busy) return;
    setBusy(true);
    try { await finishLogout(logoutRetry); } finally { setBusy(false); }
  }

  async function revoke(item: AccountSession) {
    setBusy(true);
    try {
      const response = await browserFetch("/api/financial/account/sessions/" + item.id, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setSessions(items => items.filter(x => x.id !== item.id));
      if (item.current) await finishLogout({ action: "revoke" });
    } catch { setNotice("Não foi possível encerrar a sessão."); }
    finally { setBusy(false); }
  }

  async function exportData() {
    setBusy(true);
    try {
      const ticket = await browserFetch("/api/financial/account/export", { method: "POST" });
      if (!ticket.ok) throw new Error();
      const response = await browserFetch("/api/financial/account/export/download", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: (await ticket.json()).token }),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      const url = URL.createObjectURL(new Blob([data.json], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "receivy-dados.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("Exportação baixada. Guarde o arquivo em local seguro.");
    } catch { setNotice("Não foi possível exportar. Tente novamente."); }
    finally { setBusy(false); }
  }

  async function erase() {
    if (confirmation !== "EXCLUIR" || busy) return;
    setBusy(true);
    let deleted = false;
    try {
      // No automatic retry/redirect: a 401 cannot certify that deletion committed.
      const response = await fetch("/api/financial/account", {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      deleted = response.ok && (await response.json()).deleted === true;
    } catch {}
    try { await finishLogout({ action: "delete", deleted }); }
    finally { setBusy(false); }
  }

  return (
    <section className="financial-page detail-section account-settings">
      <h2>Sua conta</h2>
      {notice && <p role="status">{notice}</p>}
      {logoutRetry && (
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void retryLogout()}>
          Tentar encerrar a sessão novamente
        </button>
      )}
      {ended ? <a className="secondary-button" href="/login">Voltar ao login</a> : user && (
        <>
          <form className="creation-form" onSubmit={event => { event.preventDefault(); void save(); }}>
            <label>Nome
              <input required maxLength={120} value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
            </label>
            <label>Idioma
              <select value="pt-BR" disabled><option value="pt-BR">Português (Brasil)</option></select>
            </label>
            <p>Português (Brasil) é o idioma disponível no MVP.</p>
            <label>Fuso horário
              <input required maxLength={64} value={timezone} onChange={e => setTimezone(e.target.value)} />
            </label>
            <label>País
              <select value="BR" disabled><option value="BR">Brasil</option></select>
            </label>
            <button type="submit" className="primary-button" disabled={busy || !name.trim()}>
              Salvar perfil
            </button>
          </form>
              <section className="detail-section" aria-labelledby="account-sessions-heading">
                <h3 id="account-sessions-heading">Sessões e dispositivos</h3>
                {sessions.map(item => (
                  <div className="account-session" key={item.id}>
                    <p>{item.deviceName}{item.current ? " (esta sessão)" : ""} — último acesso {new Date(item.lastSeenAt).toLocaleString("pt-BR")}</p>
                    <button type="button" className="secondary-button" disabled={busy} onClick={() => void revoke(item)}>
                      Encerrar {item.deviceName}
                    </button>
                  </div>
                ))}
              </section>
              <section className="detail-section" aria-labelledby="account-export-heading">
                <h3 id="account-export-heading">Seus dados</h3>
                <p>Exportação privada em JSON. A autorização temporária expira em cinco minutos e exige sua sessão ativa.</p>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => void exportData()}>Exportar dados</button>
              </section>
              <section className="creation-form account-danger" aria-labelledby="account-delete-heading">
                <h3 id="account-delete-heading">Excluir conta</h3>
                <p>Encerra sessões, revoga links e remove seus arquivos identificados. Registros compartilhados e comprovantes de outras pessoas podem ser preservados com referências anonimizadas. Avisos já enviados não podem ser recolhidos.</p>
                <label>Digite EXCLUIR para confirmar
                  <input value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" />
                </label>
                <button type="button" className="danger-button" disabled={busy || confirmation !== "EXCLUIR"} onClick={() => void erase()}>
                  Excluir conta definitivamente
                </button>
              </section>
        </>
      )}
      <p><a href="/terms">Termos de uso</a> · <a href="/privacy">Privacidade</a></p>
    </section>
  );
}
