"use client";

import { pixKeyField, PixKeyType } from "@receivy/common";
import { X } from "lucide-react";
import { useRef } from "react";
import { PIX_TYPE_LABELS, PixTypeIcon } from "@/components/ui/pix-type-icon";

type PixKeyFieldsProps = {
  type: PixKeyType;
  /** The key as the person sees it: already masked for the current type. */
  value: string;
  inputId?: string;
  required?: boolean;
  onPickType: (type: PixKeyType) => void;
  /** Receives whatever was typed, pasted or cleared; the owner masks and stores it. */
  onChange: (raw: string) => void;
};

const TYPES: { value: PixKeyType; wide?: boolean }[] = [{ value: PixKeyType.Cpf }, { value: PixKeyType.Cnpj }, { value: PixKeyType.Phone }, { value: PixKeyType.Email }, { value: PixKeyType.Random, wide: true }];

// `keyboard` is the shared vocabulary with the native app; the web maps it to
// the matching `inputMode` so the mobile keyboard opens on the right layout.
const INPUT_MODES: Record<string, "numeric" | "tel" | "email" | "text"> = {
  numeric: "numeric",
  tel: "tel",
  email: "email",
  text: "text",
};

/** The key-type chips and the masked key input, shared by the wallet form and the conta a pagar form. */
export function PixKeyFields({ type, value, inputId = "pix-key", required = false, onPickType, onChange }: PixKeyFieldsProps) {
  const field = useRef<HTMLInputElement>(null);
  const spec = pixKeyField(type);

  async function paste() {
    try {
      const text = await navigator.clipboard?.readText();

      if (!text) {
        field.current?.focus();
        return;
      }

      onChange(text);
    } catch {
      field.current?.focus();
    }
  }

  function clear() {
    onChange("");
    field.current?.focus();
  }

  return (
    <>
      <section className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink">Tipo de Chave</span>
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6" role="radiogroup" aria-label="Tipo de chave">
          {TYPES.map(option => {
            const active = type === option.value;

            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onPickType(option.value)}
                className={`flex min-h-[76px] items-center justify-center gap-1.5 rounded-xl border bg-surface p-3 text-xs font-bold text-ink transition active:scale-[0.985] ${
                  option.wide ? "col-span-2 flex-row" : "flex-col"
                } ${active ? "border-2 border-primary" : "border-outline/60 hover:border-outline"}`}
              >
                <PixTypeIcon type={option.value} size={22} className={active ? "text-primary" : "text-muted"} />
                <span>{PIX_TYPE_LABELS[option.value]}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-semibold text-ink">
          {spec.label}
        </label>
        <div className="flex h-[52px] items-center rounded-xl border border-outline bg-surface pl-3.5 pr-2 focus-within:border-primary focus-within:outline-[3px] focus-within:outline-primary focus-within:outline-offset-[3px]">
          <PixTypeIcon type={type} size={20} className="shrink-0 text-muted" />
          <input
            id={inputId}
            ref={field}
            type="text"
            required={required}
            maxLength={254}
            inputMode={INPUT_MODES[spec.keyboard]}
            placeholder={spec.placeholder}
            value={value}
            onChange={event => onChange(event.target.value)}
            className="h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-[16px] tracking-wide text-primary-strong outline-none placeholder:text-muted focus-visible:outline-none"
          />
          {value ? (
            <button type="button" aria-label="Limpar" onClick={clear} className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-muted">
              <X size={16} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" onClick={() => void paste()} className="h-9 rounded-full px-2 text-xs font-bold text-primary hover:bg-surface-muted">
              Colar
            </button>
          )}
        </div>
      </section>
    </>
  );
}
