import { formatMoney, type PublicChargeView } from "@receivy/common";
import type { Metadata } from "next";
import { authApiFetch } from "@/lib/auth/api";
import { PublicPixCopy } from "@/components/public-pix-copy";

export const metadata: Metadata = { title: "Cobrança | Receivy", referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PublicChargePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params; let charge: PublicChargeView | null = null;
  try { const response = await authApiFetch(`public/charges/${encodeURIComponent(token)}`, { method: "GET" }); if (response.ok) charge = await response.json(); } catch { /* truthful unavailable state below */ }
  if (!charge) return <main className="public-charge"><div className="public-brand">Receivy</div><section><h1>Link indisponível</h1><p>Este link expirou, foi trocado ou não existe. Peça um novo link a quem enviou a cobrança.</p></section></main>;
  return <main className="public-charge"><div className="public-brand">Receivy</div><section><span className={`state-label ${charge.state}`}>{charge.state === "pending" ? "Pendente" : charge.state === "paid" ? "Pago" : "Cancelado"}</span><h1>{charge.description}</h1><p>Cobrança de {charge.creditorFirstName}</p><strong className="public-amount">{formatMoney(charge.amount)}</strong><dl><div><dt>Vencimento</dt><dd>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${charge.dueDate}T00:00:00Z`))}</dd></div></dl>{charge.pix && <div className="public-pix"><h2>Chave Pix</h2><code>{charge.pix.key}</code><PublicPixCopy pixKey={charge.pix.key} /><p>Confira o nome do destinatário no seu banco antes de transferir.</p></div>}{charge.state === "pending" ? <p className="public-guidance">O envio de comprovante estará disponível em uma próxima etapa. Por enquanto, combine a confirmação com {charge.creditorFirstName}.</p> : <p className="public-guidance">Esta cobrança não aceita novas ações porque está {charge.state === "paid" ? "paga" : "cancelada"}.</p>}</section></main>;
}
