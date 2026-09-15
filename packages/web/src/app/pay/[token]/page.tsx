import { formatMoney, type ChargeState, type PublicChargeView } from "@receivy/common";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { authApiFetch } from "@/lib/auth/api";
import { PublicPixCopy } from "@/components/app/public-pix-copy";
import { ProofPanel } from "@/components/app/proof-panel";

export const metadata: Metadata = { title: "Cobrança | Receivy", referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATE_LABELS: Record<ChargeState, string> = {
  pending: "Pendente",
  paid: "Pago",
  cancelled: "Cancelado",
};

const PAGE = "min-h-screen bg-canvas px-4 pb-16 pt-6 md:flex md:items-center md:justify-center md:px-10 md:py-10";
const SHELL = "mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-3xl border border-outline bg-surface md:max-w-[980px] md:flex-row";
const HERO = "flex flex-col justify-between gap-6 bg-primary px-5 pb-[26px] pt-6 text-on-primary md:w-[400px] md:shrink-0 md:px-8 md:py-9";
const BODY = "flex min-w-0 flex-1 flex-col gap-5 p-5 md:px-[34px] md:py-9";
const CHIP = "inline-flex h-[26px] items-center rounded-lg bg-on-primary/20 px-2.5 text-[11.5px] font-semibold md:h-7 md:rounded-[9px] md:px-[11px] md:text-xs";
const SECTION_LABEL = "m-0 text-[10.5px] font-semibold tracking-[0.09em] text-muted";

function dueDateText(dueDate: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${dueDate}T00:00:00Z`));
}

function Brand() {
  return (
    <p className="m-0 flex items-center gap-2.5 font-display text-base font-bold">
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-on-primary/20">
        R
      </span>
      Receivy
    </p>
  );
}

function NoAccountNote({ creditor, className, iconClassName }: { creditor: string; className: string; iconClassName: string }) {
  return (
    <p className={`m-0 items-start gap-2.5 text-xs leading-normal ${className}`}>
      <span aria-hidden="true" className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] ${iconClassName}`}>
        <ShieldCheck size={15} />
      </span>
      <span>Você não precisa criar conta. {creditor} confirma o pagamento depois de revisar o comprovante.</span>
    </p>
  );
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
        <div className={SHELL}>
          <section className={HERO}>
            <Brand />
            <h1 className="m-0 font-display text-2xl font-bold">Link indisponível</h1>
          </section>
          <div className={BODY}>
            <p className="m-0 text-sm leading-6 text-muted">Este link expirou, foi trocado ou não existe. Peça um novo link a quem enviou a cobrança.</p>
          </div>
        </div>
      </main>
    );
  }

  const pix = charge.state === "pending" ? charge.pix : null;

  return (
    <main className={PAGE}>
      <div className={SHELL}>
        <section className={HERO}>
          <div className="flex flex-col">
            <Brand />
            <p className="m-0 mt-7 text-[12.5px] font-semibold text-on-primary/80 md:mt-9">{charge.creditorFirstName} está cobrando</p>
            <h1 className="m-0 mt-2 font-display text-xl font-bold md:text-2xl">{charge.description}</h1>
            <strong className="mt-3.5 font-display text-[40px] font-bold leading-none tracking-[-0.02em] tabular-nums md:mt-[18px] md:text-[46px]">{formatMoney(charge.amount)}</strong>
            <div className="mt-3.5 flex flex-wrap gap-2 md:mt-[18px]">
              <span className={CHIP}>Vence {dueDateText(charge.dueDate)}</span>
              <span className={CHIP}>{STATE_LABELS[charge.state]}</span>
            </div>
          </div>

          <NoAccountNote creditor={charge.creditorFirstName} className="hidden text-on-primary/85 md:flex" iconClassName="bg-on-primary/20" />
        </section>

        <div className={BODY}>
          {pix && (
            <section className="flex flex-col gap-2.5">
              <h2 className={SECTION_LABEL}>1 · PAGUE COM PIX</h2>
              <div className="flex flex-col gap-3 rounded-2xl border border-outline/60 bg-surface-muted/50 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <span className="text-[11.5px] text-muted">Chave Pix</span>
                  <code className="mt-0.5 block break-all font-sans text-[15px] font-semibold text-ink">{pix.key}</code>
                </div>
                <div className="flex flex-col gap-2">
                  <PublicPixCopy pixKey={pix.key} />
                </div>
              </div>
              <p className="m-0 text-[12.5px] leading-normal text-muted">Confira o nome do destinatário no seu banco antes de transferir.</p>
            </section>
          )}

          <section className="flex flex-col gap-2.5">
            <h2 className={SECTION_LABEL}>{pix ? "2 · ENVIE O COMPROVANTE" : "ENVIE O COMPROVANTE"}</h2>
            <ProofPanel base={`/api/public-proof/${encodeURIComponent(token)}`} state={charge.state} uploadsEnabled={charge.uploadsEnabled} creditor={charge.creditorFirstName} />
          </section>

          <NoAccountNote creditor={charge.creditorFirstName} className="flex rounded-2xl border border-outline/60 bg-surface-muted/50 p-3.5 text-muted md:hidden" iconClassName="bg-success-soft text-success" />

          <Link className="self-center text-[12.5px] font-semibold text-primary md:self-start" href="/login">
            Criar conta para acompanhar tudo
          </Link>
        </div>
      </div>
    </main>
  );
}
