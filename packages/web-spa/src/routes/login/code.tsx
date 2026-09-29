import { createFileRoute, redirect } from "@tanstack/react-router";
import { CodeScreen } from "@/components/screens/code-screen";
import { hasSession } from "@/lib/auth/session";

export const Route = createFileRoute("/login/code")({
  beforeLoad: () => {
    if (hasSession()) {
      throw redirect({ to: "/feed" });
    }
  },
  head: () => ({ meta: [{ title: "Código | Receivy" }] }),
  component: LoginCodePage,
});

function LoginCodePage() {
  return (
    <main className="flex min-h-dvh flex-col bg-canvas px-5 pb-8 pt-2 md:justify-center md:px-8 md:py-16">
      <CodeScreen />
    </main>
  );
}
