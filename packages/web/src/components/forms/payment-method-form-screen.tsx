"use client";

import { apiErrorCode, pixKeyField, PaymentProvider, PixKeyType, type PaymentMethod, type PaymentMethodsPage } from "@receivy/common";
import { Check, Loader2, Star } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { patchDraft } from "@/lib/billing-draft";
import { responseMessage } from "@/lib/financial-response";
import { PixKeyFields } from "@/components/app/pix-key-fields";
import { ScreenFooter } from "@/components/ui/screen-footer";

type PaymentMethodFormScreenProps = { returnTo?: string; required?: boolean };

type ErrorPayload = { message?: string; context?: { code?: string; fields?: Record<string, string> } };

const SAVE_ERROR = "Não foi possível salvar o meio de pagamento.";

export function PaymentMethodFormScreen({ returnTo, required = false }: PaymentMethodFormScreenProps) {
  const router = useRouter();
  const [provider, setProvider] = useState<PaymentProvider>(PaymentProvider.Pix);
  const [type, setType] = useState<PixKeyType>(PixKeyType.Email);
  const [key, setKey] = useState("");
  const [touched, setTouched] = useState(false);
  const [handle, setHandle] = useState("");
  const [makeDefault, setMakeDefault] = useState(true);
  // A ref, not state: the list request reads it from a closure created at mount.
  const defaultTouched = useRef(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPhone, setAccountPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; redirectUrl?: string }>({ message: "" });

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
          setAccountPhone(pixKeyField(PixKeyType.Phone).format(payload.user.phone));
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
    setError({ message: "" });
  }

  function change(raw: string) {
    setError({ message: "" });
    setTouched(true);
    setKey(pixKeyField(type).format(raw));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError({ message: "" });
    setBusy(true);

    try {
      const response = await browserFetch("/api/financial/payment-methods", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(provider === PaymentProvider.InfinitePay ? { provider, value: handle } : { provider, kind: type, value: spec.unformat(value) }),
      });

      if (!response.ok) {
        const payload = (await response
          .clone()
          .json()
          .catch(() => null)) as ErrorPayload | null;

        if (apiErrorCode(payload) === "INFINITEPAY_CHECKOUT_DISABLED") {
          setError({ message: payload?.message ?? SAVE_ERROR, redirectUrl: payload?.context?.fields?.redirectUrl });

          return;
        }

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

      router.push("/settings/payment-methods");
    } catch (reason) {
      setError({ message: reason instanceof Error ? reason.message : SAVE_ERROR });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mx-auto flex w-full max-w-md flex-col gap-6 pb-4 md:max-w-2xl" onSubmit={submit}>
      {required && (
        <p className="m-0 rounded-xl bg-warning-soft p-4 text-sm font-semibold text-warning" role="status">
          Você precisa de um meio de pagamento para criar cobranças.
        </p>
      )}

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="text-xs font-semibold text-muted">Tipo de meio</legend>
        <div role="radiogroup" aria-label="Tipo de meio" className="flex gap-2">
          {[
            { value: PaymentProvider.Pix, label: "Pix" },
            { value: PaymentProvider.InfinitePay, label: "InfinitePay" },
          ].map(option => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={provider === option.value}
              onClick={() => {
                setProvider(option.value);
                setError({ message: "" });
              }}
              className={`min-h-11 flex-1 rounded-xl border px-3 text-sm font-semibold ${provider === option.value ? "border-primary bg-primary-soft/40 text-primary-strong" : "border-outline/40 bg-surface text-ink"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      {provider === PaymentProvider.Pix ? (
        <PixKeyFields type={type} value={value} required onPickType={pick} onChange={change} />
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor="infinitepay-handle" className="text-xs font-semibold text-muted">
            InfiniteTag
          </label>
          <div className="flex min-h-12 items-center rounded-xl border border-outline/50 bg-surface px-3">
            <span aria-hidden="true" className="pr-1 text-sm font-bold text-muted">
              $
            </span>
            <input
              id="infinitepay-handle"
              value={handle}
              required
              maxLength={41}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              onChange={event => {
                setError({ message: "" });
                setHandle(event.target.value);
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
            />
          </div>
          <p className="m-0 text-xs leading-5 text-muted">É o nome de usuário do app InfinitePay. O checkout externo precisa estar ativo lá; a cobrança aceita Pix ou cartão em até 12x.</p>
        </div>
      )}

      <section className="flex items-center justify-between gap-4 rounded-xl border border-outline/40 bg-surface p-4">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="method-default" className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <Star size={16} aria-hidden="true" className="fill-current text-success" />
            Definir como meio principal
          </label>
          <p className="m-0 text-xs leading-5 text-muted">Este meio será usado como padrão ao criar novas cobranças.</p>
        </div>
        <span className="relative inline-flex shrink-0 items-center">
          <input
            id="method-default"
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
            className="relative h-7 w-12 rounded-full bg-outline/60 transition after:absolute after:left-[2px] after:top-[2px] after:h-6 after:w-6 after:rounded-full after:bg-surface after:shadow-sm after:transition peer-checked:bg-primary peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30"
          />
        </span>
      </section>

      {error.message && (
        <p className="m-0 flex flex-col gap-2 rounded-xl bg-danger-soft p-4 text-sm text-danger" role="alert">
          {error.message}
          {error.redirectUrl && (
            <a href={error.redirectUrl} target="_blank" rel="noopener noreferrer" className="font-bold underline">
              Abrir configurações da InfinitePay
            </a>
          )}
        </p>
      )}

      <ScreenFooter className="-mx-1 border-t border-outline/30 bg-canvas/95 px-1 pb-2 pt-4 backdrop-blur-md">
        <button
          type="submit"
          aria-label="Salvar meio de pagamento"
          disabled={busy}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-on-primary transition active:scale-[0.985] disabled:opacity-60"
        >
          {busy ? <Loader2 size={18} aria-hidden="true" className="animate-spin" /> : <Check size={18} aria-hidden="true" />}
          {busy ? "Salvando…" : "Salvar meio de pagamento"}
        </button>
      </ScreenFooter>
    </form>
  );
}
