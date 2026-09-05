import { CalendarCheck, Link2, ListChecks } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { safeNextPath } from "@/lib/auth/cookies";

type LoginPageProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next ?? null);

  return (
    <main className="login-page">
      <section className="login-story" aria-labelledby="login-story-title">
        <a className="login-brand" href="/login" aria-label="Receivy — entrar">
          <span className="brand-mark" aria-hidden="true"><span>R</span></span>
          <span>Receivy</span>
        </a>
        <div className="login-story-copy">
          <p className="login-eyebrow">Cobranças pessoais, sem ruído</p>
          <h1 id="login-story-title">O que você recebe e o que precisa pagar, lado a lado.</h1>
          <p>Entre pelo seu e-mail para reunir cobranças, vencimentos e recebimentos em uma timeline só.</p>
        </div>
        <ul className="login-benefits">
          <li><ListChecks aria-hidden="true" /><span><strong>Uma timeline</strong> para entradas e saídas.</span></li>
          <li><Link2 aria-hidden="true" /><span><strong>Um link simples</strong> para cada cobrança.</span></li>
          <li><CalendarCheck aria-hidden="true" /><span><strong>Datas claras</strong> para saber o que vem depois.</span></li>
        </ul>
        <p className="login-story-footnote">Você decide o que criar, compartilhar e manter.</p>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <a className="login-brand login-mobile-brand" href="/login" aria-label="Receivy — entrar">
          <span className="brand-mark" aria-hidden="true"><span>R</span></span>
          <span>Receivy</span>
        </a>
        <div className="login-card">
          <p className="login-eyebrow">Bem-vindo</p>
          <h2 id="login-title">Entre no Receivy</h2>
          <p className="login-intro">Sem senha. Enviaremos um código de uso único para o seu e-mail.</p>
          <LoginForm nextPath={nextPath} oauthError={params.error === "oauth"} />
        </div>
        <p className="login-legal">Ao continuar, você concorda com os termos e a política de privacidade.</p>
      </section>
    </main>
  );
}
