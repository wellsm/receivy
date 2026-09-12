import { formatMoney, type ChargeState, type PublicChargeView } from "@receivy/common";
import type { Metadata } from "next";
import { authApiFetch } from "@/lib/auth/api";
import { PublicPixCopy } from "@/components/app/public-pix-copy";
import { ProofPanel } from "@/components/app/proof-panel";
import { StatusTag } from "@/components/ui/status-tag";

export const metadata: Metadata = { title: "Cobrança | Receivy", referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATE_TAGS: Record<ChargeState, { label: string; tone: "warning" | "success" | "neutral" }> = {
  pending: { label: "Pendente", tone: "warning" },
  paid: { label: "Pago", tone: "success" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};

const PAGE = "min-h-screen bg-canvas px-4 pb-16 pt-7";
const COLUMN = "mx-auto flex w-full max-w-md flex-col gap-6 md:max-w-2xl";
const BRAND = "m-0 text-[22px] font-extrabold text-primary-strong";
const CARD = "flex flex-col gap-4 rounded-2xl border border-outline/30 bg-surface p-6 md:p-10";
const TITLE = "m-0 text-3xl font-extrabold leading-tight tracking-tight text-primary-strong md:text-4xl";

function dueDateText(dueDate: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${dueDate}T00:00:00Z`));
}

export default async function PublicChargePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let charge: PublicChargeView | null = null;

  try {
    const response = await authApiFetch(`public/charges/${encodeURIComponent(token)}`, { method: "GET" });

    if (response.ok) {
      charge = await response.json();
    }
  } catch {
    // A missing or unreachable charge falls through to the truthful unavailable state below.
  }

  if (!charge) {
    return (
      <main className={PAGE}>
        <div className={COLUMN}>
          <p className={BRAND}>Receivy</p>
          <section className={CARD}>
            <h1 className={TITLE}>Link indisponível</h1>
            <p className="m-0 text-sm leading-6 text-muted">Este link expirou, foi trocado ou não existe. Peça um novo link a quem enviou a cobrança.</p>
          </section>
        </div>
      </main>
    );
  }

  const state = STATE_TAGS[charge.state];
  const pix = charge.state === "pending" ? charge.pix : null;

  return (
    <main className={PAGE}>
      <div className={COLUMN}>
        <p className={BRAND}>Receivy</p>

        <section className={CARD}>
          <div className="flex">
            <StatusTag label={state.label} tone={state.tone} />
          </div>
          <h1 className={TITLE}>{charge.description}</h1>
          <p className="m-0 text-sm text-muted">Cobrança de {charge.creditorFirstName}</p>
          <strong className="text-4xl font-extrabold tracking-tight text-primary-strong tabular-nums md:text-5xl">{formatMoney(charge.amount)}</strong>

          <dl className="m-0 border-t border-outline/20 pt-4">
            <div>
              <dt className="text-xs text-muted">Vencimento</dt>
              <dd className="m-0 mt-1 font-bold text-ink">{dueDateText(charge.dueDate)}</dd>
            </div>
          </dl>

          {pix && (
            <div className="flex flex-col gap-3 rounded-xl bg-surface-muted p-4">
              <h2 className="m-0 text-base font-bold text-ink">Chave Pix</h2>
              <code className="block break-all text-sm font-semibold text-ink">{pix.key}</code>
              <PublicPixCopy pixKey={pix.key} />
              <p className="m-0 text-xs leading-5 text-muted">Confira o nome do destinatário no seu banco antes de transferir.</p>
            </div>
          )}
        </section>

        <ProofPanel base={`/api/public-proof/${encodeURIComponent(token)}`} state={charge.state} uploadsEnabled={charge.uploadsEnabled} />
      </div>
    </main>
  );
}
