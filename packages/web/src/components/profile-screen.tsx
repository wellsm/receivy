"use client";

import {
  Check,
  ChevronRight,
  KeyRound,
  LogOut,
  Mail,
  Pencil,
  Trash2,
  TriangleAlert,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ACCOUNT_DELETED, ACCOUNT_DELETION_UNCONFIRMED, type AuthUser } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";

type Dialog = "logout" | "delete" | null;

const FALLBACK_TIMEZONE = "America/Sao_Paulo";

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

export function ProfileScreen({ version }: { version: string }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(false);
  // Holds the `deleted` outcome while the browser session could not be cleared yet.
  const [logoutRetry, setLogoutRetry] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    void browserFetch("/api/auth/me")
      .then((response) => (response.ok ? (response.json() as Promise<{ user: AuthUser }>) : Promise.reject(new Error())))
      .then((payload) => {
        if (!active) return;

        setUser(payload.user);
        setDraft(payload.user.name ?? "");
      })
      .catch(() => {
        if (!active) return;

        setNotice("Não foi possível carregar sua conta.");
      });

    return () => {
      active = false;
    };
  }, []);

  async function saveName() {
    const name = draft.trim();

    if (!name || busy) return;

    setBusy(true);

    try {
      const response = await browserFetch("/api/financial/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, locale: "pt-BR", country: "BR", timezone: deviceTimezone() }),
      });

      if (!response.ok) throw new Error();

      const payload = (await response.json()) as { user: AuthUser };

      setUser(payload.user);
      setDraft(payload.user.name ?? "");
      setEditing(false);
      setNotice("");
    } catch {
      setNotice("Não foi possível salvar o nome.");
    } finally {
      setBusy(false);
    }
  }

  /** `deleted` is null for a plain logout, and the deletion outcome after an erase. */
  async function finishLogout(deleted: boolean | null) {
    let cleared = false;

    try {
      cleared = (await fetch("/api/auth/logout", { method: "POST" })).ok;
    } catch {
      cleared = false;
    }

    if (cleared) {
      setLogoutRetry(null);
      setEnded(true);

      if (deleted === null) {
        setNotice("");
        router.replace("/login");
        return;
      }

      setNotice(deleted ? ACCOUNT_DELETED : ACCOUNT_DELETION_UNCONFIRMED);
      return;
    }

    // A failed request cannot establish that the HttpOnly browser cookies were cleared.
    if (deleted === null) {
      setNotice("Não foi possível sair. Tente novamente.");
      return;
    }

    setLogoutRetry(deleted);
    setNotice(
      deleted
        ? "Conta excluída, mas não foi possível encerrar a sessão neste navegador."
        : "Não foi possível confirmar a exclusão nem encerrar a sessão. Conecte-se e tente novamente.",
    );
  }

  async function logout() {
    if (busy) return;

    setBusy(true);
    setDialog(null);

    try {
      await finishLogout(null);
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    if (confirmation !== "EXCLUIR" || busy) return;

    setBusy(true);
    setDialog(null);
    let deleted = false;

    try {
      const response = await browserFetch("/api/financial/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });

      deleted = response.ok && ((await response.json()) as { deleted: boolean }).deleted === true;
    } catch {
      deleted = false;
    }

    try {
      await finishLogout(deleted);
    } finally {
      setBusy(false);
    }
  }

  async function retryLogout() {
    if (logoutRetry === null || busy) return;

    setBusy(true);

    try {
      await finishLogout(logoutRetry);
    } finally {
      setBusy(false);
    }
  }

  function closeDialog() {
    setDialog(null);
    setConfirmation("");
  }

  const initial = (user?.name?.trim().charAt(0) || "R").toUpperCase();

  return (
    <div className="profile-page">
      <header className="profile-header">
        <h1>Perfil</h1>
      </header>

      {notice && (
        <p className="profile-notice" role="status">
          {notice}
        </p>
      )}

      {logoutRetry !== null && (
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void retryLogout()}>
          Tentar encerrar a sessão novamente
        </button>
      )}

      {ended && (
        <Link className="secondary-button" href="/login">
          Voltar ao login
        </Link>
      )}

      {!ended && user && (
        <>
          <section className="profile-identity">
            <span className="profile-avatar" aria-hidden="true">
              {initial}
            </span>

            {editing ? (
              <div className="profile-name-row">
                <input
                  className="profile-name-input"
                  aria-label="Nome"
                  maxLength={120}
                  autoComplete="name"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="profile-icon-button"
                  aria-label="Salvar nome"
                  disabled={busy || !draft.trim()}
                  onClick={() => void saveName()}
                >
                  <Check aria-hidden="true" size={18} strokeWidth={2} />
                </button>
              </div>
            ) : (
              <div className="profile-name-row">
                <strong className="profile-name">{user.name ?? "Sem nome"}</strong>
                <button
                  type="button"
                  className="profile-icon-button"
                  aria-label="Editar nome"
                  onClick={() => {
                    setDraft(user.name ?? "");
                    setEditing(true);
                  }}
                >
                  <Pencil aria-hidden="true" size={18} strokeWidth={2} />
                </button>
              </div>
            )}

            <p className="profile-email">
              <Mail aria-hidden="true" size={16} strokeWidth={1.8} />
              <span>{user.email}</span>
            </p>
          </section>

          <section aria-labelledby="profile-management-title">
            <h2 className="profile-section-title" id="profile-management-title">
              Gerenciamento
            </h2>

            <div className="profile-list">
              <Link className="profile-row" href="/people" aria-label="Gerenciar contatos">
                <span className="profile-row-icon">
                  <Users aria-hidden="true" size={20} strokeWidth={1.8} />
                </span>
                <span className="profile-row-text">
                  <strong>Meus Contatos</strong>
                  <small>Gerenciar pessoas e dados salvos de cobrança</small>
                </span>
                <ChevronRight aria-hidden="true" size={20} strokeWidth={1.8} />
              </Link>

              <Link className="profile-row" href="/settings/pix" aria-label="Gerenciar chaves Pix">
                <span className="profile-row-icon">
                  <KeyRound aria-hidden="true" size={20} strokeWidth={1.8} />
                </span>
                <span className="profile-row-text">
                  <strong>Minhas Chaves Pix</strong>
                  <small>Chaves cadastradas para receber pagamentos</small>
                </span>
                <ChevronRight aria-hidden="true" size={20} strokeWidth={1.8} />
              </Link>
            </div>
          </section>

          <section aria-labelledby="profile-security-title">
            <h2 className="profile-section-title" id="profile-security-title">
              Segurança e Sessão
            </h2>

            <div className="profile-list">
              <button
                type="button"
                className="profile-row"
                aria-label="Sair da conta"
                disabled={busy}
                onClick={() => setDialog("logout")}
              >
                <span className="profile-row-icon">
                  <LogOut aria-hidden="true" size={20} strokeWidth={1.8} />
                </span>
                <span className="profile-row-text">
                  <strong>Sair da conta</strong>
                  <small>Encerrar sessão ativa neste dispositivo</small>
                </span>
                <ChevronRight aria-hidden="true" size={20} strokeWidth={1.8} />
              </button>

              <button
                type="button"
                className="profile-row profile-row-danger"
                aria-label="Excluir conta"
                disabled={busy}
                onClick={() => {
                  setConfirmation("");
                  setDialog("delete");
                }}
              >
                <span className="profile-row-icon">
                  <Trash2 aria-hidden="true" size={20} strokeWidth={1.8} />
                </span>
                <span className="profile-row-text">
                  <strong>Excluir conta</strong>
                  <small>Remover histórico, vínculos e dados permanentemente</small>
                </span>
                <ChevronRight aria-hidden="true" size={20} strokeWidth={1.8} />
              </button>
            </div>
          </section>
        </>
      )}

      <footer className="profile-footer">
        <p className="profile-version">Receivy v{version}</p>
        <p>Lembretes inteligentes e conciliação financeira descomplicada.</p>
        <p className="profile-legal">
          <Link href="/terms">Termos</Link>
          <span aria-hidden="true"> · </span>
          <Link href="/privacy">Privacidade</Link>
        </p>
      </footer>

      {dialog === "logout" && (
        <div className="profile-backdrop">
          <div className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-logout-title">
            <h2 id="profile-logout-title">Deseja sair da sua conta?</h2>
            <p>Encerrar sessão ativa neste dispositivo.</p>
            <div className="profile-dialog-actions">
              <button type="button" className="secondary-button" onClick={closeDialog}>
                Cancelar
              </button>
              <button type="button" className="primary-button" disabled={busy} onClick={() => void logout()}>
                Sair
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === "delete" && (
        <div className="profile-backdrop">
          <div className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-delete-title">
            <span className="profile-dialog-icon" aria-hidden="true">
              <TriangleAlert size={24} strokeWidth={1.8} />
            </span>
            <h2 id="profile-delete-title">Excluir conta?</h2>
            <p>
              Esta ação é irreversível. Suas cobranças, contatos e chaves Pix serão apagados. Registros compartilhados
              podem ser preservados com referências anonimizadas.
            </p>
            <label className="profile-dialog-label" htmlFor="profile-delete-confirmation">
              Digite EXCLUIR para confirmar
            </label>
            <input
              id="profile-delete-confirmation"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <div className="profile-dialog-actions">
              <button type="button" className="secondary-button" onClick={closeDialog}>
                Cancelar
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busy || confirmation !== "EXCLUIR"}
                onClick={() => void erase()}
              >
                Confirmar exclusão
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
