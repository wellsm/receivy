"use client";

import { Check, ChevronRight, KeyRound, Loader2, LogOut, Pencil, Trash2, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ACCOUNT_DELETED, ACCOUNT_DELETION_UNCONFIRMED, THEME_PREFERENCE_OPTIONS, type AuthUser } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { squareJpeg, uploadAvatar } from "@/lib/avatar-upload";
import { useThemePreference } from "@/lib/theme";
import { InitialsAvatar } from "@/components/ui/initials-avatar";

type Dialog = "logout" | "delete" | null;

const FALLBACK_TIMEZONE = "America/Sao_Paulo";

const OUTLINE_BUTTON = "flex min-h-12 items-center justify-center rounded-xl border border-outline font-bold text-primary disabled:opacity-50";
const DIALOG_ACTION = "flex min-h-12 flex-1 items-center justify-center rounded-xl font-bold";
const CARD = "overflow-hidden rounded-[20px] border border-outline bg-surface";
const SECTION_TITLE = "m-0 text-[10.5px] font-semibold tracking-[0.09em] text-muted";
const HERO_BUTTON = "flex h-[38px] items-center gap-[7px] rounded-xl bg-on-primary/20 px-3.5 text-[12.5px] font-bold text-on-primary transition hover:bg-on-primary/30 disabled:opacity-50";
const ROW_ACTION = "hidden h-9 shrink-0 items-center rounded-[11px] border px-3.5 text-[12.5px] font-bold md:inline-flex";

const ROW_TONES = {
  primary: "bg-primary-soft text-primary-strong",
  success: "bg-success-soft text-success",
} as const;

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
  tone: keyof typeof ROW_TONES;
  href: string;
};

/** A management row: a chevron on narrow screens, a "Gerenciar" button on wide ones. */
function Row({ icon: Icon, label, title, subtitle, tone, href }: RowProps) {
  return (
    <Link className="flex min-h-14 w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-surface-muted/60 md:gap-3.5 md:px-[22px] md:py-[18px]" href={href} aria-label={label}>
      <span className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl md:h-[42px] md:w-[42px] md:rounded-[13px] ${ROW_TONES[tone]}`}>
        <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14.5px] font-semibold text-ink md:text-[15px]">{title}</span>
        <span className="text-xs leading-4 text-muted">{subtitle}</span>
      </span>

      <ChevronRight aria-hidden="true" size={16} strokeWidth={1.8} className="shrink-0 text-muted md:hidden" />
      <span aria-hidden="true" className={`${ROW_ACTION} border-outline text-ink`}>
        Gerenciar
      </span>
    </Link>
  );
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
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
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
        if (!active) {
          return;
        }

        setUser(payload.user);
        setDraft(payload.user.name ?? "");
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setNotice("Não foi possível carregar sua conta.");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!dialog) {
      return;
    }

    cancel.current?.focus();
  }, [dialog]);

  async function saveName() {
    const name = draft.trim();

    if (!name || busy) {
      return;
    }

    setBusy(true);

    try {
      const response = await browserFetch("/api/financial/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, locale: "pt-BR", country: "BR", timezone: deviceTimezone() }),
      });

      if (!response.ok) {
        throw new Error();
      }

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

  async function changePhoto(file: File | undefined) {
    if (!file || !user) {
      return;
    }

    setPhotoBusy(true);
    setPhotoError("");

    try {
      const avatar = await uploadAvatar(await squareJpeg(file));

      setUser({ ...user, avatar });
    } catch (reason) {
      setPhotoError(reason instanceof Error ? reason.message : "Não foi possível trocar a foto.");
    } finally {
      setPhotoBusy(false);
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
    if (busy) {
      return;
    }

    setBusy(true);
    setDialog(null);

    try {
      await finishLogout(null);
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    if (confirmation !== "EXCLUIR" || busy) {
      return;
    }

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
    if (logoutRetry === null || busy) {
      return;
    }

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
        <div className="grid gap-[18px] md:grid-cols-[minmax(0,380px)_minmax(0,1fr)] md:items-start md:gap-7">
          <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-[18px] rounded-3xl bg-primary p-5 text-on-primary md:rounded-[22px] md:p-[26px]">
              <div className="flex items-center gap-4">
                <div className="relative h-[72px] w-[72px] shrink-0">
                  <InitialsAvatar name={initial} size={72} avatar={user.avatar} />

                  <label
                    className={`absolute -right-1 -bottom-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-primary bg-surface text-primary-strong shadow-md transition has-disabled:cursor-not-allowed has-focus-visible:ring-2 has-focus-visible:ring-on-primary ${photoBusy ? "opacity-90" : ""}`}
                  >
                    {photoBusy ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : <Pencil size={15} aria-hidden="true" />}
                    <span className="sr-only">{photoBusy ? "Enviando foto…" : "Trocar foto"}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic"
                      aria-label="Trocar foto"
                      disabled={photoBusy}
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];

                        event.target.value = "";
                        void changePhoto(file);
                      }}
                    />
                  </label>
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {editing ? (
                    <div className="flex w-full items-center gap-2">
                      <input
                        className="min-h-11 min-w-0 flex-1 rounded-xl border-0 bg-surface px-3 text-ink"
                        aria-label="Nome"
                        maxLength={120}
                        autoComplete="name"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                      />
                      <button
                        type="button"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-on-primary/20 text-on-primary disabled:opacity-50"
                        aria-label="Salvar nome"
                        disabled={busy || !draft.trim()}
                        onClick={() => void saveName()}
                      >
                        <Check aria-hidden="true" size={20} strokeWidth={2} />
                      </button>
                    </div>
                  ) : (
                    <p className="m-0 truncate font-display text-xl font-bold md:text-[22px]">{user.name ?? "Sem nome"}</p>
                  )}
                  <p className="m-0 truncate text-[12.5px] text-on-primary/80">{user.email}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2.5">
                {!editing && (
                  <button
                    type="button"
                    className={HERO_BUTTON}
                    aria-label="Editar nome"
                    disabled={busy}
                    onClick={() => {
                      setDraft(user.name ?? "");
                      setEditing(true);
                    }}
                  >
                    <Pencil aria-hidden="true" size={15} strokeWidth={2} />
                    Editar nome
                  </button>
                )}
                <button type="button" className={HERO_BUTTON} aria-label="Sair da conta" disabled={busy} onClick={() => setDialog("logout")}>
                  <LogOut aria-hidden="true" size={15} strokeWidth={2} />
                  Sair
                </button>
              </div>
            </section>

            {photoError && (
              <p role="alert" className="m-0 rounded-xl bg-danger-soft px-3 py-2 text-center text-sm text-danger">
                {photoError}
              </p>
            )}

            <section className="flex flex-col gap-3 rounded-[20px] border border-outline bg-surface p-[18px]" aria-labelledby="profile-appearance-title">
              <h2 className={SECTION_TITLE} id="profile-appearance-title">
                APARÊNCIA
              </h2>

              <div role="radiogroup" aria-labelledby="profile-appearance-title" className="flex gap-[7px]">
                {THEME_PREFERENCE_OPTIONS.map(option => {
                  const selected = option.value === themePreference;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => chooseTheme(option.value)}
                      className={`min-h-10 flex-1 rounded-xl text-[13px] transition ${selected ? "bg-primary-soft font-bold text-primary-strong" : "bg-surface-muted font-semibold text-muted hover:text-ink"}`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          <div className="flex flex-col gap-4">
            <section className={CARD} aria-labelledby="profile-management-title">
              <h2 className={`${SECTION_TITLE} border-b border-outline/60 px-4 py-3.5 md:px-[22px]`} id="profile-management-title">
                GERENCIAMENTO
              </h2>

              <Row icon={Users} tone="primary" label="Gerenciar contatos" title="Meus Contatos" subtitle="Gerenciar pessoas e dados salvos de cobrança" href="/contacts" />
              <div className="mx-4 h-px bg-outline/60 md:mx-0" />
              <Row icon={KeyRound} tone="success" label="Gerenciar meios de pagamento" title="Meios de pagamento" subtitle="Pix e InfinitePay para receber pagamentos" href="/settings/payment-methods" />
            </section>

            <button
              type="button"
              aria-label="Excluir conta"
              disabled={busy}
              onClick={() => {
                setConfirmation("");
                setDialog("delete");
              }}
              className="flex w-full items-center gap-3 rounded-[20px] border border-danger/30 bg-surface px-4 py-3.5 text-left transition hover:bg-danger-soft/40 disabled:opacity-50 md:gap-3.5 md:px-[22px] md:py-[18px]"
            >
              <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-danger-soft text-danger md:h-[42px] md:w-[42px] md:rounded-[13px]">
                <Trash2 aria-hidden="true" size={19} strokeWidth={1.8} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[14.5px] font-semibold text-danger md:text-[15px]">Excluir conta</span>
                <span className="text-xs leading-4 text-muted">Remove histórico, vínculos e dados permanentemente</span>
              </span>
              <span aria-hidden="true" className={`${ROW_ACTION} border-danger/30 text-danger`}>
                Excluir
              </span>
            </button>
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
          <h2 id="profile-logout-title" className="m-0 font-display text-xl font-bold text-ink">
            Deseja sair da sua conta?
          </h2>

          <p className="m-0 leading-5 text-muted">Encerrar sessão ativa neste dispositivo.</p>

          <div className="flex gap-3">
            <button ref={cancel} type="button" className={`${DIALOG_ACTION} border border-outline text-muted`} onClick={closeDialog}>
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

          <h2 id="profile-delete-title" className="m-0 font-display text-xl font-bold text-ink">
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
            <button ref={cancel} type="button" className={`${DIALOG_ACTION} border border-outline text-muted`} onClick={closeDialog}>
              Cancelar
            </button>
            <button type="button" className={`${DIALOG_ACTION} bg-danger-solid text-on-danger disabled:opacity-50`} disabled={busy || confirmation !== "EXCLUIR"} onClick={() => void erase()}>
              Confirmar exclusão
            </button>
          </div>
        </DialogShell>
      )}
    </section>
  );
}
