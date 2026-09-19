import { ChargeState, formatMoney, PaymentLinkState, PaymentProvider, type PublicChargeView } from "@receivy/common";
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

function NoAccountNote({ creditor, automatic, className, iconClassName }: { creditor: string; automatic: boolean; className: string; iconClassName: string }) {
  return (
    <p className={`m-0 items-start gap-2.5 text-xs leading-normal ${className}`}>
      <span aria-hidden="true" className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] ${iconClassName}`}>
        <ShieldCheck size={15} />
      </span>
      <span>
        Você não precisa criar conta. {automatic ? "O pagamento pelo link é confirmado automaticamente." : `${creditor} confirma o pagamento depois de revisar o comprovante.`}
      </span>
    </p>
  );
}

export default async function PublicChargePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const query = await searchParams;
  const returned = query.order_nsu && query.transaction_nsu && query.slug ? { orderNsu: query.order_nsu, transactionNsu: query.transaction_nsu, slug: query.slug } : null;
  let charge: PublicChargeView | null = null;

  try {
    // Back from InfinitePay: the ids in the url close the charge (after payment_check) before the page renders.
    const response = returned
      ? await authApiFetch(`public/charges/${encodeURIComponent(token)}/provider-return`, { method: "POST", body: JSON.stringify(returned) })
      : await authApiFetch(`public/charges/${encodeURIComponent(token)}`, { method: "GET" });

    if (response.ok) {
      charge = await response.json();
    } else if (returned) {
      // A refused return (wrong ids, provider down) still shows the charge as it is.
      const fallback = await authApiFetch(`public/charges/${encodeURIComponent(token)}`, { method: "GET" });

      charge = fallback.ok ? await fallback.json() : null;
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

  const payment = charge.state === ChargeState.Pending ? charge.payment : null;
  const pix = payment?.provider === PaymentProvider.Pix ? payment : null;
  const link = payment?.provider === PaymentProvider.InfinitePay ? charge.paymentLink : null;
  const numbered = Boolean(pix || (link?.state === PaymentLinkState.Ready && link.url));

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

          <NoAccountNote creditor={charge.creditorFirstName} automatic={Boolean(link)} className="hidden text-on-primary/85 md:flex" iconClassName="bg-on-primary/20" />
        </section>

        <div className={BODY}>
          {pix && (
            <section className="flex flex-col gap-2.5">
              <h2 className={SECTION_LABEL}>1 · PAGUE COM PIX</h2>
              <div className="flex flex-col gap-3 rounded-2xl border border-outline/60 bg-surface-muted/50 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <span className="text-[11.5px] text-muted">Chave Pix</span>
                  <code className="mt-0.5 block break-all font-sans text-[15px] font-semibold text-ink">{pix.value}</code>
                </div>
                <div className="flex flex-col gap-2">
                  <PublicPixCopy pixKey={pix.value} />
                </div>
              </div>
              <p className="m-0 text-[12.5px] leading-normal text-muted">Confira o nome do destinatário no seu banco antes de transferir.</p>
            </section>
          )}

          {link && link.state === PaymentLinkState.Ready && link.url && (
            <section className="flex flex-col gap-2.5">
              <h2 className={SECTION_LABEL}>1 · PAGUE PELO LINK</h2>
              <div className="flex flex-col gap-3 rounded-2xl border border-outline/60 bg-surface-muted/50 p-4">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-bold text-on-primary transition hover:bg-primary-strong"
                >
                  Pagar
                </a>
                <p className="m-0 text-[12.5px] leading-normal text-muted">Pix ou cartão em até 12x, pela InfinitePay. A confirmação chega sozinha depois do pagamento.</p>
              </div>
            </section>
          )}

          {link && link.state !== PaymentLinkState.Ready && (
            <p className="m-0 rounded-2xl border border-outline/60 bg-surface-muted/50 p-3.5 text-[12.5px] leading-normal text-muted" role="status">
              Estamos gerando o link de pagamento. Tente de novo em instantes, ou envie o comprovante abaixo.
            </p>
          )}

          {charge.state === ChargeState.Paid && (
            <section className="flex flex-col gap-2 rounded-2xl border border-success/40 bg-success-soft p-4">
              <h2 className="m-0 text-sm font-bold text-success">Pagamento confirmado</h2>
              {charge.receiptUrl && (
                <a href={charge.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-semibold text-primary">
                  Ver comprovante da InfinitePay
                </a>
              )}
            </section>
          )}

          {charge.state !== ChargeState.Paid && (link?.state === PaymentLinkState.Ready ? (
            <details className="flex flex-col gap-2.5">
              <summary className="cursor-pointer text-[12.5px] font-semibold text-muted">Pagou de outro jeito? Envie o comprovante</summary>
              <ProofPanel base={`/api/public-proof/${encodeURIComponent(token)}`} state={charge.state} uploadsEnabled={charge.uploadsEnabled} creditor={charge.creditorFirstName} />
            </details>
          ) : (
            <section className="flex flex-col gap-2.5">
              <h2 className={SECTION_LABEL}>{numbered ? "2 · ENVIE O COMPROVANTE" : "ENVIE O COMPROVANTE"}</h2>
              <ProofPanel base={`/api/public-proof/${encodeURIComponent(token)}`} state={charge.state} uploadsEnabled={charge.uploadsEnabled} creditor={charge.creditorFirstName} />
            </section>
          ))}

          <NoAccountNote creditor={charge.creditorFirstName} automatic={Boolean(link)} className="flex rounded-2xl border border-outline/60 bg-surface-muted/50 p-3.5 text-muted md:hidden" iconClassName="bg-success-soft text-success" />

          <Link className="self-center text-[12.5px] font-semibold text-primary md:self-start" href="/login">
            Criar conta para acompanhar tudo
          </Link>
        </div>
      </div>
    </main>
  );
}
