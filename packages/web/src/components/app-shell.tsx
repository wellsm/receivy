import {
  CalendarClock,
  ContactRound,
  ListChecks,
  Plus,
  Settings,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  { href: "/", label: "Timeline", icon: ListChecks },
  { href: "/recurrences", label: "Recorrências", icon: CalendarClock },
  { href: "/people", label: "Contatos", icon: ContactRound },
  { href: "/settings", label: "Ajustes", icon: Settings },
] as const;

type AppShellProps = {
  children: ReactNode;
  activePath?: string;
  hideCreateAction?: boolean;
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

export function AppShell({ children, activePath = "/", hideCreateAction = false }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <Navigation activePath={activePath} />
        <div className="sidebar-footnote">
          <span className="status-dot" aria-hidden="true" />
          Seus registros, sob seu controle.
        </div>
      </aside>

      <div className="workspace">
        <header className="mobile-header">
          <Brand />
        </header>

        <main className="main-content">{children}</main>

        {!hideCreateAction && <Link className="floating-action" href="/charges/new" aria-label="Nova cobrança">
          <Plus aria-hidden="true" size={23} />
          <span>Nova cobrança</span>
        </Link>}

        <Navigation mobile activePath={activePath} />
      </div>
    </div>
  );
}
