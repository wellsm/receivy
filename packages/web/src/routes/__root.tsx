import { createRootRoute, HeadContent, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({ component: RootLayout, notFoundComponent: NotFound, errorComponent: RootError });

function RootLayout() {
  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  );
}

function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas px-5 text-center">
      <h1 className="m-0 font-display text-2xl font-bold text-ink">Página não encontrada</h1>
      <p className="m-0 text-sm text-muted">Confira o endereço.</p>
      <Link className="text-sm font-semibold text-primary" to="/">Voltar ao início</Link>
    </main>
  );
}

function RootError() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas px-5 text-center">
      <h1 className="m-0 font-display text-2xl font-bold text-ink">Algo deu errado</h1>
      <Link className="text-sm font-semibold text-primary" to="/">Voltar ao início</Link>
    </main>
  );
}
