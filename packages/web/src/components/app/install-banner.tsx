import { Share, X } from "lucide-react";
import { useId } from "react";
import { InstallOffer, useInstallOffer } from "@/lib/install";

/**
 * The invitation to install the site as an app, for someone already signed in on a phone. Below `md` only: on a
 * wide screen the browser's own install button in the address bar does the job. It shows nothing inside the
 * installed app, where the site cannot be installed, or for 30 days after being dismissed.
 */
export function InstallBanner() {
  const state = useInstallOffer();
  const titleId = useId();

  if (!state) {
    return null;
  }

  const { offer, install, dismiss } = state;

  return (
    <section aria-labelledby={titleId} className="mb-4 flex items-start gap-3 rounded-2xl border border-outline bg-surface p-3.5 md:hidden">
      <img className="block h-11 w-11 shrink-0 rounded-[11px] object-cover" src="/brand-icon.png" alt="" width={44} height={44} />

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-col gap-0.5">
          <h2 id={titleId} className="m-0 font-display text-[15px] font-bold tracking-[-0.01em] text-ink">
            Instalar o Receivy
          </h2>

          {offer === InstallOffer.Ios ? (
            <p className="m-0 text-[13px] leading-[1.45] text-muted">
              Toque em <Share aria-hidden="true" size={14} strokeWidth={2} className="inline align-[-2px] text-primary" /> <strong className="font-semibold text-ink">Compartilhar</strong> e depois em{" "}
              <strong className="font-semibold text-ink">Adicionar à Tela de Início</strong>.
            </p>
          ) : (
            <p className="m-0 text-[13px] leading-[1.45] text-muted">Abra direto da tela inicial, em tela cheia.</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {offer === InstallOffer.Prompt && (
            <button type="button" onClick={() => void install()} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-on-primary">
              Instalar
            </button>
          )}

          {/* Alone on the row it lines up with the text above; beside the install button it keeps its own padding. */}
          <button
            type="button"
            onClick={dismiss}
            className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-muted ${offer === InstallOffer.Prompt ? "px-3" : "pr-3"}`}
          >
            <X aria-hidden="true" size={15} strokeWidth={2} />
            Agora não
          </button>
        </div>
      </div>
    </section>
  );
}
