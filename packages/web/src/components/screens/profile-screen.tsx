"use client";

import { Check, ChevronRight, KeyRound, LogOut, Mail, Pencil, Trash2, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ACCOUNT_DELETED, ACCOUNT_DELETION_UNCONFIRMED, THEME_PREFERENCE_OPTIONS, type AuthUser } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { useThemePreference } from "@/lib/theme";
import { InitialsAvatar } from "@/components/ui/initials-avatar";

type Dialog = "logout" | "delete" | null;

const FALLBACK_TIMEZONE = "America/Sao_Paulo";

const OUTLINE_BUTTON = "flex min-h-12 items-center justify-center rounded-xl border border-outline font-bold text-primary disabled:opacity-50";
const DIALOG_ACTION = "flex min-h-12 flex-1 items-center justify-center rounded-xl font-bold";
const LIST = "overflow-hidden rounded-3xl border border-outline/40 bg-surface";
const SECTION_TITLE = "m-0 px-1 text-xs font-bold tracking-wider text-muted";

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

type RowProps = {
  icon: LucideIcon;
  label: string;
  title: string;
  subtitle: string;
  danger?: boolean;
  disabled?: boolean;
  href?: string;
  onClick?: () => void;
};

/** A list row: a link when it navigates, a button when it opens a dialog. */
function Row({ icon: Icon, label, title, subtitle, danger = false, disabled = false, href, onClick }: RowProps) {
  const className = "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-muted/60 disabled:opacity-50";

  const content = (
    <>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${danger ? "bg-danger-soft text-danger" : "bg-surface-muted text-primary-strong"}`}>
        <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`text-base font-bold ${danger ? "text-danger" : "text-ink"}`}>{title}</span>
        <span className="text-xs leading-4 text-muted">{subtitle}</span>
      </span>

      <ChevronRight aria-hidden="true" size={18} strokeWidth={1.8} className="shrink-0 text-muted" />
    </>
  );

  if (href) {
    return (
      <Link className={className} href={href} aria-label={label}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={className} aria-label={label} disabled={disabled} onClick={onClick}>
      {content}
    </button>
  );
}

function Divider() {
  return <div className="mx-4 h-px bg-outline/40" />;
}

type DialogShellProps = { titleId: string; onClose: () => void; children: ReactNode };

/** Backdrop and panel shared by the logout and delete dialogs; Escape closes them. */
function DialogShell({ titleId, onClose, children }: DialogShellProps) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-scrim px-6"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-surface p-6 shadow-2xl">
        {children}
      </div>
    </div>
  );
}

export function ProfileScreen() {
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
  const cancel = useRef<HTMLButtonElement>(null);
  const [themePreference, chooseTheme] = useThemePreference();

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

  useEffect(() => {
    if (!dialog) return;

    cancel.current?.focus();
  }, [dialog]);

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
      // No automatic retry/redirect: a 401 cannot certify that deletion committed.
      const response = await fetch("/api/financial/account", {
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

  const initial = user?.name?.trim() || "R";

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-5 md:max-w-none">
      {notice && (
        <p className="m-0 rounded-2xl bg-surface-muted p-4 leading-5 text-ink" role="status">
          {notice}
        </p>
      )}

      {logoutRetry !== null && (
        <button type="button" className={OUTLINE_BUTTON} disabled={busy} onClick={() => void retryLogout()}>
          Tentar encerrar a sessão novamente
        </button>
      )}

      {ended && (
        <Link className={OUTLINE_BUTTON} href="/login">
          Voltar ao login
        </Link>
      )}

      {!ended && user && (
        <div className="grid gap-5 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:items-start md:gap-6">
          <section className="flex flex-col items-center gap-3 rounded-3xl border border-outline/40 bg-surface p-6">
            <InitialsAvatar name={initial} size={96} />

            {editing ? (
              <div className="flex w-full items-center gap-2">
                <input
                  className="min-h-12 flex-1 rounded-xl border border-outline bg-canvas px-3 text-ink"
                  aria-label="Nome"
                  maxLength={120}
                  autoComplete="name"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary disabled:opacity-50"
                  aria-label="Salvar nome"
                  disabled={busy || !draft.trim()}
                  onClick={() => void saveName()}
                >
                  <Check aria-hidden="true" size={20} strokeWidth={2} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="m-0 text-2xl font-extrabold text-ink">{user.name ?? "Sem nome"}</p>
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-primary-strong disabled:opacity-50"
                  aria-label="Editar nome"
                  disabled={busy}
                  onClick={() => {
                    setDraft(user.name ?? "");
                    setEditing(true);
                  }}
                >
                  <Pencil aria-hidden="true" size={18} strokeWidth={2} />
                </button>
              </div>
            )}

            <p className="m-0 flex items-center gap-2 text-sm text-muted">
              <Mail aria-hidden="true" size={16} strokeWidth={1.8} />
              <span>{user.email}</span>
            </p>
          </section>

          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-2" aria-labelledby="profile-management-title">
              <h2 className={SECTION_TITLE} id="profile-management-title">
                GERENCIAMENTO
              </h2>

              <div className={LIST}>
                <Row icon={Users} label="Gerenciar contatos" title="Meus Contatos" subtitle="Gerenciar pessoas e dados salvos de cobrança" href="/contacts" />
                <Divider />
                <Row icon={KeyRound} label="Gerenciar chaves Pix" title="Minhas Chaves Pix" subtitle="Chaves cadastradas para receber pagamentos" href="/settings/pix" />
              </div>
            </section>

            <section className="flex flex-col gap-2" aria-labelledby="profile-appearance-title">
              <h2 className={SECTION_TITLE} id="profile-appearance-title">
                APARÊNCIA
              </h2>

              <div
                role="radiogroup"
                aria-labelledby="profile-appearance-title"
                className="flex gap-2 rounded-3xl border border-outline/40 bg-surface p-2"
              >
                {THEME_PREFERENCE_OPTIONS.map(option => {
                  const selected = option.value === themePreference;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => chooseTheme(option.value)}
                      className={`min-h-11 flex-1 rounded-2xl text-sm font-semibold transition ${
                        selected
                          ? "bg-primary-soft/60 text-primary-strong"
                          : "text-muted hover:bg-surface-muted"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="flex flex-col gap-2" aria-labelledby="profile-security-title">
              <h2 className={SECTION_TITLE} id="profile-security-title">
                SEGURANÇA E SESSÃO
              </h2>

              <div className={LIST}>
                <Row icon={LogOut} label="Sair da conta" title="Sair da conta" subtitle="Encerrar sessão ativa neste dispositivo" disabled={busy} onClick={() => setDialog("logout")} />
                <Divider />
                <Row
                  icon={Trash2}
                  label="Excluir conta"
                  title="Excluir conta"
                  subtitle="Remover histórico, vínculos e dados permanentemente"
                  danger
                  disabled={busy}
                  onClick={() => {
                    setConfirmation("");
                    setDialog("delete");
                  }}
                />
              </div>
            </section>
          </div>
        </div>
      )}

      <footer className="flex flex-col items-center gap-1 pt-2">
        <p className="m-0 flex items-center gap-2">
          <Link className="flex min-h-12 items-center font-bold text-primary" href="/terms">
            Termos
          </Link>
          <span className="text-muted" aria-hidden="true">
            ·
          </span>
          <Link className="flex min-h-12 items-center font-bold text-primary" href="/privacy">
            Privacidade
          </Link>
        </p>
      </footer>

      {dialog === "logout" && (
        <DialogShell titleId="profile-logout-title" onClose={closeDialog}>
          <h2 id="profile-logout-title" className="m-0 text-xl font-extrabold text-ink">
            Deseja sair da sua conta?
          </h2>

          <p className="m-0 leading-5 text-muted">Encerrar sessão ativa neste dispositivo.</p>

          <div className="flex gap-3">
            <button ref={cancel} type="button" className={`${DIALOG_ACTION} border border-outline text-primary`} onClick={closeDialog}>
              Cancelar
            </button>
            <button type="button" className={`${DIALOG_ACTION} bg-primary text-on-primary disabled:opacity-50`} disabled={busy} onClick={() => void logout()}>
              Sair
            </button>
          </div>
        </DialogShell>
      )}

      {dialog === "delete" && (
        <DialogShell titleId="profile-delete-title" onClose={closeDialog}>
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger" aria-hidden="true">
            <TriangleAlert size={24} strokeWidth={1.8} />
          </span>

          <h2 id="profile-delete-title" className="m-0 text-xl font-extrabold text-ink">
            Excluir conta?
          </h2>

          <p className="m-0 leading-5 text-muted">
            Esta ação é irreversível. Suas cobranças, contatos e chaves Pix serão apagados. Registros compartilhados podem ser preservados com referências anonimizadas.
          </p>

          <label className="font-bold text-ink" htmlFor="profile-delete-confirmation">
            Digite EXCLUIR para confirmar
          </label>
          <input
            id="profile-delete-confirmation"
            className="min-h-12 rounded-xl border border-outline bg-canvas px-3 text-ink"
            autoComplete="off"
            autoCapitalize="characters"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />

          <div className="flex gap-3">
            <button ref={cancel} type="button" className={`${DIALOG_ACTION} border border-outline text-primary`} onClick={closeDialog}>
              Cancelar
            </button>
            <button type="button" className={`${DIALOG_ACTION} bg-danger-solid text-on-primary disabled:opacity-50`} disabled={busy || confirmation !== "EXCLUIR"} onClick={() => void erase()}>
              Confirmar exclusão
            </button>
          </div>
        </DialogShell>
      )}
    </section>
  );
}
