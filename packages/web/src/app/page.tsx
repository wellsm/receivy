import { ArrowDownLeft, ArrowUpRight, CalendarDays } from "lucide-react";

export default function TimelinePage() {
  return (
    <div className="timeline-page">
      <header className="page-heading">
        <div>
          <p className="date-line">Sua visão de hoje</p>
          <h1>O que entra. O que sai. No mesmo lugar.</h1>
        </div>
        <p className="heading-support">
          Cobranças criadas por você e valores vinculados ao seu e-mail aparecem
          juntos, sempre com a direção identificada.
        </p>
      </header>

      <section className="balance-ledger" aria-labelledby="balance-title">
        <h2 id="balance-title" className="visually-hidden">
          Resumo de valores
        </h2>
        <article className="balance-side receivable">
          <ArrowDownLeft aria-hidden="true" size={22} />
          <div>
            <span>A receber</span>
            <strong>R$ 0,00</strong>
          </div>
          <small>Nenhuma cobrança pendente</small>
        </article>
        <div className="ledger-spine" aria-hidden="true">
          <span />
        </div>
        <article className="balance-side payable">
          <ArrowUpRight aria-hidden="true" size={22} />
          <div>
            <span>A pagar</span>
            <strong>R$ 0,00</strong>
          </div>
          <small>Nenhum valor vinculado</small>
        </article>
      </section>

      <section className="empty-timeline" aria-labelledby="timeline-title">
        <div className="timeline-rail" aria-hidden="true">
          <span />
        </div>
        <div className="empty-copy">
          <CalendarDays aria-hidden="true" size={28} strokeWidth={1.6} />
          <p className="date-line">Timeline</p>
          <h2 id="timeline-title">Sua timeline começa aqui</h2>
          <p>
            Crie uma cobrança ou entre com o e-mail em que recebeu uma. Os
            próximos vencimentos serão organizados por data.
          </p>
        </div>
      </section>
    </div>
  );
}
