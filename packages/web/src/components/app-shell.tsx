import {
  Bell,
  ReceiptText,
  Rows3,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  { href: "/", label: "Feed", icon: Rows3 },
  { href: "/billings", label: "Cobranças", icon: ReceiptText },
  { href: "/settings", label: "Perfil", icon: UserRound },
] as const;

type AppShellProps = {
  children: ReactNode;
  activePath?: string;
  notificationsBadge?: boolean;
};

function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Receivy — início">
      <span className="brand-mark" aria-hidden="true">
        <span>R</span>
      </span>
      <span>Receivy</span>
    </Link>
  );
}

function HeaderBell({ badge = false }: { badge?: boolean }) {
  return (
    <Link className="header-bell" href="/settings#notifications" aria-label="Notificações">
      <Bell aria-hidden="true" size={21} strokeWidth={1.8} />
      {badge && <span className="header-bell-dot" aria-hidden="true" />}
    </Link>
  );
}

function Navigation({ mobile = false, activePath = "/" }: { mobile?: boolean; activePath?: string }) {
  return (
    <nav
      className={mobile ? "mobile-navigation" : "desktop-navigation"}
      aria-label={mobile ? "Navegação principal móvel" : "Navegação principal"}
    >
      {navigation.map(({ href, label, icon: Icon }) => (
        <Link
          className={href === activePath ? "navigation-link is-active" : "navigation-link"}
          href={href}
          key={href}
          aria-current={href === activePath ? "page" : undefined}
        >
          <Icon aria-hidden="true" size={21} strokeWidth={1.8} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function AppShell({ children, activePath = "/", notificationsBadge = false }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <Brand />
          <HeaderBell badge={notificationsBadge} />
        </div>
        <Navigation activePath={activePath} />
        <div className="sidebar-footnote">
          <span className="status-dot" aria-hidden="true" />
          Seus registros, sob seu controle.
        </div>
      </aside>

      <div className="workspace">
        <header className="mobile-header">
          <Brand />
          <HeaderBell badge={notificationsBadge} />
        </header>

        <main className="main-content">{children}</main>

        <Navigation mobile activePath={activePath} />
      </div>
    </div>
  );
}
