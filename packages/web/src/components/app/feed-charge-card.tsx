import { formatMoney, type Direction, type ListChargeItem } from "@receivy/common";
import Link from "next/link";
import { InitialsAvatar } from "../ui/initials-avatar";

type ChargeCardProps = {
  charge: ListChargeItem;
  direction: Direction;
  today: string;
  /** Card actions stay optional while the list endpoint does not answer with what they need. */
  reminded?: string | null;
  onRemind?: () => void;
  onMarkPaid?: () => void;
  onDeclare?: () => void;
};

export function FeedChargeCard({
  charge,
  direction,
  // reminded,
  // onRemind,
  // onMarkPaid,
  // onDeclare,
}: ChargeCardProps) {
  // const [confirmRemind, setConfirmRemind] = useState(false);
  // const [confirmPaid, setConfirmPaid] = useState(false);
  // const [confirmDeclare, setConfirmDeclare] = useState(false);
  // const badges = chargeBadges(charge, today);
  // const action = chargeAction(charge, direction);
  const settled = charge.state !== "pending";
  const amountClass = settled ? "text-muted" : direction === "receivable" ? "text-ink" : "text-payable";

  // The whole row opens the charge through one stretched link. Nesting the action inside it would
  // not be accessible, so the link is a sibling overlay and the action is raised above it.
  return (
    <article
      className={`relative flex items-center gap-3 border-b border-outline/60 bg-surface px-[18px] py-3 md:gap-4 md:rounded-[18px] md:border md:border-outline md:py-4 ${settled ? "opacity-60 md:opacity-100" : ""}`}
    >
      <Link
        href={`/charges/${charge.id}`}
        aria-label={`Abrir cobrança ${charge.description}`}
        className="absolute inset-0 focus-visible:outline-[3px] focus-visible:outline-primary focus-visible:-outline-offset-2 md:rounded-[18px]"
      />

      <span className="hidden md:block">
        <InitialsAvatar name={charge.debtor?.name ?? 'N/A'} size={44} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="m-0 truncate text-[13.5px] font-bold text-ink md:text-[15.5px] md:font-semibold">
          {charge.description} · <span className="font-semibold text-muted md:font-normal">{charge.debtor?.name ?? 'N/A'}</span>
        </p>
        {/* {badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {badges.map(badge => (
              <StatusTag key={badge.label} label={badge.label} tone={badge.tone} />
            ))}
          </div>
        )} */}
      </div>

      <div className="flex shrink-0 flex-col items-end md:w-[120px]">
        <strong className={`font-display text-sm font-bold tabular-nums md:text-[19px] ${amountClass}`}>{formatMoney({ amountCents: charge.amount_cents, currency: 'BRL' })}</strong>
        {/* <span className="text-[11px] text-muted md:text-[11.5px]">{chargeStateLabel(charge, direction)}</span> */}
      </div>

      {/* {action?.kind === ChargeActionKind.Remind && (
        <button
          type="button"
          disabled={reminded !== null}
          onClick={() => setConfirmRemind(true)}
          className="relative flex h-[30px] shrink-0 items-center gap-[7px] rounded-[9px] bg-primary-soft px-2.5 text-[11.5px] font-extrabold text-primary-strong disabled:opacity-60 md:h-10 md:rounded-xl md:bg-primary md:px-3.5 md:text-[13px] md:font-bold md:text-on-primary"
        >
          <Bell size={15} aria-hidden="true" className="hidden md:block" />
          {reminded ?? action.label}
        </button>
      )}
      {action?.kind === ChargeActionKind.MarkPaid && (
        <button
          type="button"
          onClick={() => setConfirmPaid(true)}
          className="relative flex h-[30px] shrink-0 items-center gap-[7px] rounded-[9px] bg-success-soft px-2.5 text-[11.5px] font-extrabold text-success md:h-10 md:rounded-xl md:px-3.5 md:text-[13px] md:font-bold"
        >
          <Check size={15} aria-hidden="true" className="hidden md:block" />
          {action.label}
        </button>
      )}
      {action?.kind === ChargeActionKind.DeclarePayment && (
        <button
          type="button"
          onClick={() => setConfirmDeclare(true)}
          className="relative flex h-[30px] shrink-0 items-center gap-[7px] rounded-[9px] bg-success-soft px-2.5 text-[11.5px] font-extrabold text-success md:h-10 md:rounded-xl md:px-3.5 md:text-[13px] md:font-bold"
        >
          <Check size={15} aria-hidden="true" className="hidden md:block" />
          {action.label}
        </button>
      )}

      {confirmRemind && (
        <ConfirmDialog
          title="Enviar lembrete?"
          icon={Bell}
          tone="primary"
          detail={
            <>
              <span className="text-[10.5px] font-semibold tracking-[0.08em] text-muted">PRÉVIA</span>
              <strong className="text-[13.5px] font-semibold text-ink">{charge.description}</strong>
              <span className="text-xs text-muted">
                {formatMoney(charge.amount)} · vence {feedDayLabel(charge.dueDate, today).toLowerCase()}
              </span>
            </>
          }
          explanation={`Avisa ${charge.counterpartName} por notificação no app ou por e-mail, com o link de pagamento e a chave Pix. Só um lembrete a cada 24 horas.`}
          confirmLabel="Enviar lembrete"
          onConfirm={() => {
            setConfirmRemind(false);
            onRemind();
          }}
          onCancel={() => setConfirmRemind(false)}
        />
      )}
      {confirmPaid && (
        <ConfirmDialog
          title="Marcar como paga?"
          icon={Check}
          tone="primary"
          explanation="Isso registra um pagamento integral e encerra a cobrança. Dá para reabrir depois."
          confirmLabel="Marcar paga"
          onConfirm={() => {
            setConfirmPaid(false);
            onMarkPaid();
          }}
          onCancel={() => setConfirmPaid(false)}
        />
      )}
      {confirmDeclare && (
        <ConfirmDialog
          title="Marcar como pago?"
          icon={Check}
          tone="primary"
          explanation={`${charge.counterpartName} vai receber um aviso para confirmar o recebimento.`}
          confirmLabel="Marcar pago"
          onConfirm={() => {
            setConfirmDeclare(false);
            onDeclare();
          }}
          onCancel={() => setConfirmDeclare(false)}
        />
      )} */}
    </article>
  );
}