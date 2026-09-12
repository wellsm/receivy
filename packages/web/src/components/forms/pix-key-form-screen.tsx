"use client";

import { pixKeyField, type PaymentMethod, type PaymentMethodsPage, type PixKeyType } from "@receivy/common";
import { Check, Loader2, Star } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { patchDraft } from "@/lib/billing-draft";
import { responseMessage } from "@/lib/financial-response";
import { PixKeyFields } from "@/components/app/pix-key-fields";
import { ScreenFooter } from "@/components/ui/screen-footer";

type PixKeyFormScreenProps = { returnTo?: string; required?: boolean };

const SAVE_ERROR = "Não foi possível salvar a chave Pix.";

export function PixKeyFormScreen({ returnTo, required = false }: PixKeyFormScreenProps) {
  const router = useRouter();
  const [type, setType] = useState<PixKeyType>("email");
  const [key, setKey] = useState("");
  const [touched, setTouched] = useState(false);
  const [makeDefault, setMakeDefault] = useState(true);
  // A ref, not state: the list request reads it from a closure created at mount.
  const defaultTouched = useRef(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPhone, setAccountPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;

    void browserFetch("/api/financial/payment-methods")
      .then(response => (response.ok ? (response.json() as Promise<PaymentMethodsPage>) : null))
      .then(page => {
        if (!live || !page) {
          return;
        }

        // The very first key of an account is its main one; later keys only take
        // over when the person says so. A choice made while this request was in
        // flight wins — the answer must never flip a toggle the user just set.
        setMakeDefault(current => (defaultTouched.current ? current : !page.paymentMethods.some(method => !method.archivedAt)));
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;

    void browserFetch("/api/auth/me")
      .then(response => (response.ok ? (response.json() as Promise<{ user: { email: string | null; phone?: string | null } }>) : null))
      .then(payload => {
        if (!live || !payload) {
          return;
        }

        if (payload.user.email) {
          setAccountEmail(payload.user.email);
        }

        if (payload.user.phone) {
          setAccountPhone(pixKeyField("phone").format(payload.user.phone));
        }
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, []);

  const spec = pixKeyField(type);
  // Most people register their own e-mail or phone, so an untouched field shows the
  // account value of that type. It stays editable: typing — or clearing it — takes
  // over, and picking another type starts over.
  const prefilled = type === "email" ? accountEmail : type === "phone" ? accountPhone : "";
  const value = !key && !touched ? prefilled : key;

  function pick(next: PixKeyType) {
    setType(next);
    setKey("");
    setTouched(false);
    setError("");
  }

  function change(raw: string) {
    setError("");
    setTouched(true);
    setKey(pixKeyField(type).format(raw));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      const response = await browserFetch("/api/financial/payment-methods", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pixKeyType: type, pixKey: spec.unformat(value) }),
      });

      if (!response.ok) {
        throw new Error(await responseMessage(response, SAVE_ERROR));
      }

      const saved = (await response.json()) as PaymentMethod;

      if (makeDefault && !saved.isDefault) {
        await browserFetch(`/api/financial/payment-methods/${saved.id}/default`, { method: "POST" });
      }

      // Came from the billing form: hand the new key back to the draft.
      if (returnTo) {
        patchDraft({ pix: saved.id });
        router.push(returnTo);
        return;
      }

      router.push("/settings/pix");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mx-auto flex w-full max-w-md flex-col gap-6 pb-4 md:max-w-2xl" onSubmit={submit}>
      {required && (
        <p className="m-0 rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900" role="status">
          Você precisa de uma chave Pix para criar cobranças.
        </p>
      )}

      <PixKeyFields type={type} value={value} required onPickType={pick} onChange={change} />

      <section className="flex items-center justify-between gap-4 rounded-xl border border-outline/40 bg-surface p-4">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="pix-default" className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <Star size={16} aria-hidden="true" className="fill-current text-[#006c49]" />
            Definir como chave principal
          </label>
          <p className="m-0 text-xs leading-5 text-muted">Esta chave será usada como padrão ao criar novas cobranças e links Pix.</p>
        </div>
        <span className="relative inline-flex shrink-0 items-center">
          <input
            id="pix-default"
            type="checkbox"
            className="peer sr-only"
            checked={makeDefault}
            onChange={event => {
              defaultTouched.current = true;
              setMakeDefault(event.target.checked);
            }}
          />
          <span
            aria-hidden="true"
            className="relative h-7 w-12 rounded-full bg-outline/60 transition after:absolute after:left-[2px] after:top-[2px] after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow-sm after:transition peer-checked:bg-primary peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30"
          />
        </span>
      </section>

      {error && (
        <p className="m-0 rounded-xl bg-red-50 p-4 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <ScreenFooter className="-mx-1 border-t border-outline/30 bg-canvas/95 px-1 pb-2 pt-4 backdrop-blur-md">
        <button
          type="submit"
          aria-label="Salvar chave Pix"
          disabled={busy}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-white transition active:scale-[0.985] disabled:opacity-60"
        >
          {busy ? <Loader2 size={18} aria-hidden="true" className="animate-spin" /> : <Check size={18} aria-hidden="true" />}
          {busy ? "Salvando…" : "Salvar Chave Pix"}
        </button>
      </ScreenFooter>
    </form>
  );
}
