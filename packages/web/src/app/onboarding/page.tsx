import { needsOnboarding } from "@receivy/common";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding-form";
import { currentUser } from "@/lib/auth/current-user";

export default async function OnboardingPage() {
  const user = await currentUser();

  if (user && !needsOnboarding(user)) {
    redirect("/");
  }

  return (
    <main className="onboarding-page">
      <Link className="login-brand" href="/" aria-label="Receivy — início">
        <span className="brand-mark" aria-hidden="true"><span>R</span></span>
        <span>Receivy</span>
      </Link>
      <section className="login-card onboarding-card" aria-labelledby="onboarding-title">
        <p className="login-eyebrow">Antes de começar</p>
        <h1 id="onboarding-title">Como podemos chamar você?</h1>
        <p className="login-intro">Esse nome aparece para quem recebe suas cobranças e lembretes.</p>
        <OnboardingForm />
      </section>
      <p className="login-legal">
        Ao continuar, você concorda com os <a href="/terms">Termos de uso</a> e a <a href="/privacy">Privacidade</a>.
      </p>
    </main>
  );
}
