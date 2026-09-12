import { AppShell } from "@/components/app/app-shell";
import { PixKeyFormScreen } from "@/components/forms/pix-key-form-screen";
import { safeNextPath } from "@/lib/auth/cookies";

export default async function NewPixKeyPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; required?: string }> }) {
  const { returnTo, required } = await searchParams;
  const safeReturn = returnTo ? safeNextPath(returnTo) : undefined;

  return (
    <AppShell activePath="/settings" title="Nova chave Pix" back={safeReturn ?? "/settings/pix"}>
      <PixKeyFormScreen returnTo={safeReturn} required={required === "1"} />
    </AppShell>
  );
}
