import { Bell, ReceiptText, Rows3, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { backLabelFor } from "@/lib/navigation";

const navigation = [
  { href: "/", label: "Feed", icon: Rows3 },
  { href: "/billings", label: "Contas", icon: ReceiptText },
  { href: "/settings", label: "Perfil", icon: UserRound },
] as const;

type AppShellProps = {
  children: ReactNode;
  activePath?: string;
  notificationsBadge?: boolean;
  /** Title of a sub screen; shown in the screen header the way the native stack shows it. */
  title?: string;
  /** Where the sub screen's back button goes; omitted on the three tab roots. */
  back?: string;
};

const HEADER_BAR = "sticky top-0 z-10 grid min-h-14 items-center border-b border-outline/45 bg-canvas/90 px-3 backdrop-blur-lg";

const DESKTOP_LINK = "flex min-h-12 items-center gap-[11px] rounded-xl px-3.5 text-sm font-semibold text-muted";
const DESKTOP_LINK_ACTIVE = `${DESKTOP_LINK} bg-primary-soft text-primary-strong`;

const MOBILE_LINK = "flex min-h-12 flex-col items-center justify-center gap-[3px] py-1.5 text-[11px] font-bold text-muted";
const MOBILE_LINK_ACTIVE = `${MOBILE_LINK} text-primary-strong`;

const MOBILE_ICON = "h-[30px] w-14 rounded-full py-1";
const MOBILE_ICON_ACTIVE = `${MOBILE_ICON} bg-primary-soft/45`;

function Brand() {
  return (
    <Link className="inline-flex min-h-12 items-center gap-[11px] text-xl font-bold tracking-[-0.04em] text-primary-strong" href="/" aria-label="Receivy — início">
      <Image className="block h-[38px] w-[38px] rounded-[10px] object-cover shadow-[0_6px_16px_-6px_rgba(0,56,40,0.35)]" src="/brand-icon.png" alt="" width={38} height={38} priority />
      <span>Receivy</span>
    </Link>
  );
}

function HeaderBell({ badge = false }: { badge?: boolean }) {
  return (
    <Link className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-muted" href="/settings" aria-label="Notificações">
      <Bell aria-hidden="true" size={21} strokeWidth={1.8} />
      {badge && <span className="absolute top-[9px] right-[9px] h-[9px] w-[9px] rounded-full border-2 border-surface bg-red-600" aria-hidden="true" data-testid="header-bell-dot" />}
    </Link>
  );
}

function Navigation({ mobile = false, activePath = "/" }: { mobile?: boolean; activePath?: string }) {
  const [link, activeLink, icon, activeIcon] = mobile ? [MOBILE_LINK, MOBILE_LINK_ACTIVE, MOBILE_ICON, MOBILE_ICON_ACTIVE] : [DESKTOP_LINK, DESKTOP_LINK_ACTIVE, undefined, undefined];

  return (
    <nav
      className={mobile ? "fixed inset-x-0 bottom-0 z-[15] grid min-h-[72px] grid-cols-3 border-t border-outline/60 bg-surface/95 backdrop-blur-lg md:hidden" : "grid content-start gap-1.5"}
      aria-label={mobile ? "Navegação principal móvel" : "Navegação principal"}
    >
      {navigation.map(({ href, label, icon: Icon }) => {
        const active = href === activePath;

        return (
          <Link className={active ? activeLink : link} href={href} key={href} aria-current={active ? "page" : undefined}>
            <Icon aria-hidden="true" size={21} strokeWidth={1.8} className={active ? activeIcon : icon} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Mirrors the mobile app's chrome: tab roots get a bare header with the logo, sub
 * screens get a back button and a centered title, and the three tabs sit at the bottom.
 * On wide viewports the sidebar takes over and only the sub-screen header stays.
 */
function ScreenHeader({ title, back }: { title?: string; back?: string }) {
  if (!back) {
    return (
      <header className={`${HEADER_BAR} justify-items-center md:hidden`}>
        <Image className="block h-8 w-8 rounded-[9px]" src="/brand-icon.png" alt="Receivy" width={32} height={32} priority />
      </header>
    );
  }

  return (
    <header className={`${HEADER_BAR} grid-cols-[minmax(64px,1fr)_auto_minmax(64px,1fr)] md:static md:min-h-0 md:grid-cols-[auto_minmax(0,1fr)] md:gap-[18px] md:border-b-0 md:bg-transparent md:px-8 md:pt-7 md:backdrop-blur-none`}>
      <Link className="inline-flex min-h-11 items-center gap-1.5 justify-self-start px-2 text-[17px] font-bold text-primary-strong md:text-sm" href={back}>
        ← <span className="sr-only md:not-sr-only">{backLabelFor(back)}</span>
      </Link>
      <h1 className="m-0 text-center text-[17px] font-bold tracking-[-0.01em] text-primary-strong md:text-left md:text-2xl">{title}</h1>
      <span className="md:hidden" aria-hidden="true" />
    </header>
  );
}

export function AppShell({ children, activePath = "/", notificationsBadge = false, title, back }: AppShellProps) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[236px_minmax(0,1fr)] xl:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen grid-rows-[auto_1fr_auto] gap-[54px] border-r border-outline/55 bg-surface/80 px-5 py-7 backdrop-blur-lg md:grid xl:px-7">
        <div className="flex items-center justify-between gap-3">
          <Brand />
          <HeaderBell badge={notificationsBadge} />
        </div>
        <Navigation activePath={activePath} />
        <div className="flex items-start gap-[9px] text-xs leading-[1.45] text-muted">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
          Seus registros, sob seu controle.
        </div>
      </aside>

      <div className="min-h-screen pb-[94px] md:pb-0">
        <ScreenHeader title={title} back={back} />

        <main className="mx-auto w-full max-w-[1080px] px-5 pt-4 pb-24 md:px-8 md:pt-16 md:pb-[90px] xl:px-12 xl:pt-[70px]">{children}</main>

        <Navigation mobile activePath={activePath} />
      </div>
    </div>
  );
}
