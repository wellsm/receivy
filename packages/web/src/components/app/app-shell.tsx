import { Bell, ReceiptText, Rows3, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { BackButton } from "@/components/app/back-button";

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

const HEADER_BAR = "sticky top-0 z-10 grid min-h-14 items-center border-b border-outline/60 bg-canvas/90 px-3 backdrop-blur-lg";

const DESKTOP_LINK = "flex min-h-[46px] items-center gap-[11px] rounded-[13px] px-3.5 text-sm font-semibold text-muted";
const DESKTOP_LINK_ACTIVE = `${DESKTOP_LINK} bg-primary-soft font-bold text-primary-strong`;

const MOBILE_LINK = "flex min-h-12 flex-col items-center justify-center gap-[3px] py-1.5 text-[11px] font-bold text-muted";
const MOBILE_LINK_ACTIVE = `${MOBILE_LINK} text-primary`;

const MOBILE_ICON = "h-[30px] w-14 rounded-full py-1";
const MOBILE_ICON_ACTIVE = `${MOBILE_ICON} bg-primary-soft`;

function Brand() {
  return (
    <Link className="inline-flex min-h-12 items-center gap-[11px] font-display text-xl font-bold tracking-[-0.03em] text-ink" href="/" aria-label="Receivy — início">
      <Image className="block h-[38px] w-[38px] rounded-[11px] object-cover" src="/brand-icon.png" alt="" width={38} height={38} priority />
      <span>Receivy</span>
    </Link>
  );
}

function HeaderBell({ badge = false }: { badge?: boolean }) {
  return (
    <Link className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-[11px] text-muted" href="/settings" aria-label="Notificações">
      <Bell aria-hidden="true" size={20} strokeWidth={1.8} />
      {badge && <span className="absolute top-[9px] right-[9px] h-[9px] w-[9px] rounded-full border-2 border-surface bg-payable" aria-hidden="true" data-testid="header-bell-dot" />}
    </Link>
  );
}

function Navigation({ mobile = false, activePath = "/" }: { mobile?: boolean; activePath?: string }) {
  const [link, activeLink, icon, activeIcon] = mobile ? [MOBILE_LINK, MOBILE_LINK_ACTIVE, MOBILE_ICON, MOBILE_ICON_ACTIVE] : [DESKTOP_LINK, DESKTOP_LINK_ACTIVE, undefined, undefined];

  return (
    <nav
      className={mobile ? "fixed inset-x-0 bottom-0 z-[15] grid min-h-[72px] grid-cols-3 border-t border-outline bg-surface/95 backdrop-blur-lg md:hidden" : "grid content-start gap-1.5"}
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
 * On wide viewports the sidebar takes over: tab roots get a title bar, sub screens keep their header.
 */
function ScreenHeader({ title, back, activePath }: { title?: string; back?: string; activePath: string }) {
  if (!back) {
    const tab = navigation.find(({ href }) => href === activePath);

    return (
      <>
        <header className={`${HEADER_BAR} justify-items-center md:hidden`}>
          <Image className="block h-8 w-8 rounded-[9px]" src="/brand-icon.png" alt="Receivy" width={32} height={32} priority />
        </header>
        {tab && (
          <header className="hidden border-b border-outline/60 bg-surface px-8 py-[22px] md:block xl:px-10">
            <h1 className="m-0 font-display text-[26px] font-bold tracking-[-0.02em] text-ink">{tab.label}</h1>
          </header>
        )}
      </>
    );
  }

  return (
    <header className={`${HEADER_BAR} grid-cols-[minmax(64px,1fr)_auto_minmax(64px,1fr)] md:static md:min-h-0 md:grid-cols-[auto_minmax(0,1fr)] md:gap-[18px] md:border-b-0 md:bg-transparent md:px-8 md:pt-7 md:backdrop-blur-none xl:px-10`}>
      <BackButton fallback={back} className="inline-flex min-h-11 items-center gap-1.5 justify-self-start px-2 text-[17px] font-bold text-primary md:text-sm" />
      <h1 className="m-0 text-center font-display text-[17px] font-bold tracking-[-0.01em] text-ink md:text-left md:text-2xl">{title}</h1>
      <span className="md:hidden" aria-hidden="true" />
    </header>
  );
}

export function AppShell({ children, activePath = "/", notificationsBadge = false, title, back }: AppShellProps) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[236px_minmax(0,1fr)] xl:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen grid-rows-[auto_1fr_auto] gap-[42px] border-r border-outline bg-surface px-5 py-[26px] md:grid xl:px-[22px]">
        <div className="flex items-center justify-between gap-3">
          <Brand />
          <HeaderBell badge={notificationsBadge} />
        </div>
        <Navigation activePath={activePath} />
        <div className="flex items-start gap-2.25 text-xs leading-[1.45] text-muted">
          <span className="mt-1.25 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          Seus registros, sob seu controle.
        </div>
      </aside>

      <div className="min-h-screen pb-23.5 md:pb-0">
        <ScreenHeader title={title} back={back} activePath={activePath} />

        <main className="mx-auto w-full max-w-270 px-5 pb-24 md:px-8 md:pt-7 md:pb-22.5 xl:px-10">{children}</main>

        <Navigation mobile activePath={activePath} />
      </div>
    </div>
  );
}
