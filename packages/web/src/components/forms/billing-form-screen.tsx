"use client";

import {
  addCalendarDays,
  amountDigitsToInput,
  amountInputToDigits,
  billingCategoryLabel,
  billingDraftSummary,
  billingDraftSummaryText,
  buildBillingInput,
  calendarDate,
  draftTotalCents,
  editableMonthCharges,
  editScopeExplanation,
  EMPTY_BILLING_DRAFT,
  EMPTY_SPLIT_VALUES,
  endOfMonth,
  formatAmountDigits,
  formatMoney,
  parseBRLCents,
  previewBillingSplit,
  shouldAskEditScope,
  splitPartyKey,
  splitParties,
  canNotifyContact,
  untilInstallmentPreview,
  BillingDueRule,
  BillingFrequency,
  BillingKind,
  BillingRecurrence,
  Direction,
  EditScope,
  paymentMethodText,
  PaymentProvider,
  PixKeyType,
  SplitMode,
  SplitPartKind,
  UserStatus,
  type BillingDetail,
  type BillingDraft,
  type BillingInput,
  type BillingPatch,
  type PaymentMethod,
  type Contact,
  type ContactsPage,
  type PaymentMethodsPage,
  type SplitParty,
  type SplitValues,
} from "@receivy/common";
import { CalendarClock, Check, ChevronDown, KeyRound, Loader2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { saveDraft, takeDraft, type StoredDraft } from "@/lib/billing-draft";
import { responseMessage } from "@/lib/financial-response";
import { ScopeDialog } from "@/components/app/scope-dialog";
import { CategorySelect } from "@/components/app/category-select";
import { ContactPickerSheet } from "@/components/app/contact-picker-sheet";
import { MonthSelect } from "@/components/app/month-select";
import { SplitEditor, type SplitRow } from "@/components/app/split-editor";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { ScreenFooter } from "@/components/ui/screen-footer";

type Attempt = { input: BillingInput; key: string; uncertain: boolean; applyTo?: EditScope };

type BillingFormScreenProps = {
  billing: BillingDetail | null;
  onSaved: (billing: BillingDetail) => void;
};

const RETURN_TO = "/billings/new";
const PIX_SETUP = `/settings/payment-methods/new?returnTo=${encodeURIComponent(RETURN_TO)}&required=1`;
const NEW_CONTACT = `/contacts/new?returnTo=${encodeURIComponent(RETURN_TO)}`;
const FROZEN_NOTE = "Contas já geradas só permitem categoria, Pix e lembretes.";
const PIX_GATE_TITLE = "Cadastre um meio de pagamento";
const PIX_GATE_NOTE = "Uma conta a receber gera um link de pagamento com o seu Pix, sua InfinitePay ou seu PagBank. Cadastre um e volte para continuar de onde parou.";
const NO_CONTACT_KEY = "Este contato ainda não tem chave Pix. Cadastre no contato.";
const NO_VALUES: Record<string, string> = {};

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: Direction.Receivable, label: "Vou receber" },
  { value: Direction.Payable, label: "Vou pagar" },
];

const TYPES: { value: BillingRecurrence; label: string }[] = [
  { value: BillingRecurrence.Once, label: "À vista" },
  { value: BillingRecurrence.Until, label: "Parcelado" },
  { value: BillingRecurrence.Indefinite, label: "Recorrente" },
];

/** "Já recebi" / "Já paguei" and the label of the counterpart seat, by direction. */
const SETTLED_LABELS: Record<Direction, { toggle: string; field: string }> = {
  receivable: { toggle: "Já recebi", field: "De quem" },
  payable: { toggle: "Já paguei", field: "Para quem" },
};
/** The empty counterpart seat, by direction: a conta a pagar names who receives, a registro who paid. */
const SEAT_HINTS: Record<Direction, string> = { receivable: "Escolha quem pagou.", payable: "Escolha quem recebe." };
const SETTLED_HELP = "Registro já quitado: ninguém recebe aviso. Cada ocorrência fica paga no vencimento.";
const SETTLED_LOCKED = "Não dá para mudar depois de criada.";

const AMOUNT_LABELS: Record<BillingRecurrence, string> = {
  once: "Valor total",
  until: "Valor total",
  indefinite: "Valor por ocorrência",
};

/** The segmented control shows the short label; the accessible name keeps the full one. */
const SPLIT_MODES: { value: SplitMode; label: string; name: string }[] = [
  { value: SplitMode.Equal, label: "Igual", name: "Igual" },
  { value: SplitMode.Shares, label: "Cotas", name: "Cotas" },
  { value: SplitMode.Percentage, label: "%", name: "Porcentagem" },
  { value: SplitMode.Fixed, label: "Fixo", name: "Valor fixo" },
];

const INPUT_CLASS = "h-12 w-full rounded-[14px] border border-outline bg-surface px-3.5 text-[15px] font-medium text-ink disabled:opacity-60";
const LABEL_CLASS = "ml-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await browserFetch(path, init);

  if (!response.ok) {
    const error = new Error(await responseMessage(response, "Não foi possível salvar. Tente novamente."));

    throw Object.assign(error, { status: response.status });
  }

  return response.json() as Promise<T>;
}

function moneyText(amountCents: number): string {
  return formatMoney({ amountCents, currency: "BRL" }).replace(/[^\d,]/g, "");
}

function money(amountCents: number): string {
  return formatMoney({ amountCents, currency: "BRL" });
}

function todayIn(timezone: string): string {
  try {
    return calendarDate(new Date(), timezone);
  } catch {
    return calendarDate();
  }
}

/** Rebuilds the per-mode text buckets from a saved split, so editing starts on the mode it was created with. */
function valuesFromBilling(billing: BillingDetail): SplitValues {
  const values = EMPTY_SPLIT_VALUES();

  for (const part of billing.split.parts) {
    const key = part.kind === "owner" ? "owner" : part.userId;

    if ("amountCents" in part) {
      values.fixed[key] = moneyText(part.amountCents);

      continue;
    }

    if ("basisPoints" in part) {
      values.percentage[key] = String(part.basisPoints / 100).replace(".", ",");

      continue;
    }

    if ("shares" in part) {
      values.shares[key] = String(part.shares);
    }
  }

  return values;
}

/** Each participant's current "Não notificar", so saving the edit sends back what the billing already has. */
function notifyFromBilling(billing: BillingDetail): Record<string, boolean> {
  const notify: Record<string, boolean> = {};

  for (const allocation of billing.allocations) {
    if (allocation.kind === SplitPartKind.User && allocation.userId) {
      notify[allocation.userId] = allocation.notify;
    }
  }

  return notify;
}

function draftFromBilling(billing: BillingDetail): BillingDraft {
  const parts = billing.split.parts;

  return {
    direction: billing.type,
    payee: billing.contact?.id ?? "",
    type: billing.recurrence,
    selected: parts.flatMap(part => (part.kind === "user" ? [part.userId] : [])),
    owner: parts.some(part => part.kind === "owner") || billing.split.mode === "fixed",
    // Parcelado: the form shows the total, so saving it unchanged rebuilds the same per-installment amount.
    amount: moneyText(billing.recurrence === BillingRecurrence.Until ? billing.total.amountCents * (billing.installmentCount ?? 1) : billing.total.amountCents),
    description: billing.description,
    frequency: billing.frequency ?? BillingFrequency.Monthly,
    start: billing.startDate,
    dueRule: billing.dueRule ?? BillingDueRule.Fixed,
    end: billing.endDate ?? "",
    occurrences: "",
    timezone: billing.timezone,
    pix: billing.paymentMethodId ?? "",
    mode: billing.split.mode,
    values: valuesFromBilling(billing),
    category: billing.category,
    reminders: billing.reminders.map(reminder => ({ ...reminder, offsetDays: String(reminder.offsetDays) })),
    notify: notifyFromBilling(billing),
    settled: billing.kind === BillingKind.Record,
  };
}

/** A participant the agenda no longer lists (archived, or another owner's contact): the chip still needs a name. */
function unknownContact(userId: string): Contact {
  return { id: userId, userId, name: "Contato", nickname: null, displayName: "Contato", email: "", phone: null, status: UserStatus.Pending, archivedAt: null, createdAt: "", lastBilledAt: null, activeCharges: 0 };
}

function abbreviate(pixKey: string): string {
  return pixKey.length <= 18 ? pixKey : `${pixKey.slice(0, 7)}…${pixKey.slice(-7)}`;
}

function SectionLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={LABEL_CLASS}>
      {children}
    </label>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 rounded-[20px] border border-outline bg-surface px-4 py-3.5">{children}</div>;
}

export function BillingFormScreen({ billing, onSaved }: BillingFormScreenProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<BillingDraft>(() =>
    billing ? draftFromBilling(billing) : EMPTY_BILLING_DRAFT("America/Sao_Paulo", calendarDate()),
  );
  const [recent, setRecent] = useState<Contact[]>([]);
  const [directory, setDirectory] = useState<Contact[]>([]);
  /** The owner's own keys: what a conta a receber is paid through. */
  const [wallet, setWallet] = useState<PaymentMethod[]>([]);
  /** The seated contact's keys, tagged with whose they are: an unanswered seat reads as none. */
  const [payeeKeys, setPayeeKeys] = useState<{ contactId: string; methods: PaymentMethod[] }>({ contactId: "", methods: [] });
  const [picker, setPicker] = useState(false);
  const [payeePicker, setPayeePicker] = useState(false);
  const [pixOpen, setPixOpen] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [scopeAttempt, setScopeAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [gated, setGated] = useState(false);
  const restored = useRef<StoredDraft | null>(null);
  const addContact = useRef<HTMLButtonElement>(null);
  const pickPayee = useRef<HTMLButtonElement>(null);

  const editing = Boolean(billing);
  const locked = Boolean(attempt);
  const frozen = editing && billing?.recurrence !== "indefinite";
  const payable = draft.direction === "payable";
  // A registro pays or is paid like any other conta; only reminders, splits and proofs leave the form.
  const settled = draft.settled === true;
  // The counterpart of a registro never moves: the API answers 409 for a contact change on one.
  const seatLocked = editing && settled;
  // A conta a pagar is paid by the owner and a registro is already settled: neither needs a wallet key.
  const gate = gated && !payable && !settled;
  // `BillingPatch` carries no type, frequency or dates, so the schedule is
  // read-only in every edit — otherwise Salvar would silently drop the change.
  const scheduled = editing;
  // An assinatura may move its next due date; generated occurrences keep theirs.
  const dueLocked = scheduled && billing?.recurrence !== "indefinite";

  useEffect(() => {
    // Reading the side-trip draft empties the storage, and StrictMode runs this
    // effect twice in dev: the ref survives the cleanup, so the second pass gets
    // the same draft back instead of `null`. It is applied only once the remote
    // data lands, so the form never re-renders twice on mount.
    const stored = billing ? null : (takeDraft() ?? restored.current);

    restored.current = stored;

    let live = true;

    void Promise.all([
      request<ContactsPage>("/api/contacts?sort=recent"),
      request<{ paymentMethods: PaymentMethod[] }>("/api/financial/payment-methods"),
      billing || stored ? Promise.resolve(null) : request<{ user: { timezone: string } }>("/api/auth/me"),
    ])
      .then(([agenda, keys, me]) => {
        if (!live) {
          return;
        }

        const active = keys.paymentMethods.filter(method => !method.archivedAt);

        setRecent(agenda.contacts.slice(0, 12));
        setDirectory(agenda.contacts);
        setWallet(active);
        setGated(!billing && !active.length);
        setDraft(current => {
          const base = stored ? stored.draft : current;
          const pix = billing || stored ? base.pix : (active.find(method => method.isDefault)?.id ?? base.pix);

          return { ...base, pix, ...(me ? { timezone: me.user.timezone, start: todayIn(me.user.timezone) } : {}) };
        });
        setReady(true);
      })
      .catch(reason => {
        if (!live) {
          return;
        }

        setDraft(current => (stored ? stored.draft : current));
        setError((reason as Error).message);
      });

    return () => {
      live = false;
    };
  }, [billing]);

  // Whoever receives a conta a pagar owns the key: the form only picks among the seated contact's.
  useEffect(() => {
    const contactId = draft.payee;

    if (!payable || settled || !contactId) {
      return;
    }

    let live = true;

    void request<PaymentMethodsPage>(`/api/financial/payment-methods?contactId=${contactId}`)
      .then(page => {
        if (!live) {
          return;
        }

        const methods = page.paymentMethods.filter(method => !method.archivedAt);

        setPayeeKeys({ contactId, methods });
        // A key of the contact the seat just left cannot pay this one: fall back to their
        // default. A seeded edit already points at one of these, and keeps it.
        setDraft(current => ({
          ...current,
          pix: methods.some(method => method.id === current.pix) ? current.pix : (methods.find(method => method.isDefault)?.id ?? methods[0]?.id ?? ""),
        }));
      })
      .catch(() => {
        if (live) {
          setPayeeKeys({ contactId, methods: [] });
        }
      });

    return () => {
      live = false;
    };
  }, [payable, settled, draft.payee]);

  function update(patch: Partial<BillingDraft>) {
    if (locked) {
      return;
    }

    setError("");
    setDraft(current => ({ ...current, ...patch }));
  }

  function toggle(userId: string) {
    update({ selected: draft.selected.includes(userId) ? draft.selected.filter(id => id !== userId) : [...draft.selected, userId] });
  }

  function switchNotify(userId: string, notify: boolean) {
    update({ notify: { ...draft.notify, [userId]: notify } });
  }

  /** The counterpart seat holds one contact: picking another replaces it, picking the seated one empties it. */
  function seat(contact: Contact) {
    if (payable) {
      update({ payee: draft.payee === contact.id ? "" : contact.id });

      return;
    }

    update({ selected: draft.selected[0] === contact.userId ? [] : [contact.userId] });
  }

  function clearSeat() {
    update(payable ? { payee: "" } : { selected: [] });
  }

  /**
   * Each direction is paid through other keys: a conta a pagar through the seated
   * contact's, a conta a receber through the owner's wallet. Carrying the chosen
   * key across the flip would pay the wrong side, so it starts over — the wallet
   * default for a conta a receber, the seat's own for a conta a pagar.
   */
  function pickDirection(direction: Direction) {
    update({ direction, pix: direction === Direction.Payable ? "" : (wallet.find(item => item.isDefault)?.id ?? "") });
  }

  const remember = useCallback((contacts: Contact[]) => {
    setDirectory(current => [...current, ...contacts.filter(contact => !current.some(known => known.id === contact.id))]);
  }, []);

  function leaveTo(path: string) {
    saveDraft(draft, RETURN_TO);
    router.push(path);
  }

  /** The key of a conta a pagar lives on the contact: the hint sends the owner there and back. */
  function leaveToContactKeys() {
    const back = billing ? `/billings/${billing.id}/edit` : RETURN_TO;
    const path = `/contacts/${draft.payee}/edit?returnTo=${encodeURIComponent(back)}`;

    // An edit is not restorable from a stored draft: only a creation leaves one behind.
    if (editing) {
      router.push(path);

      return;
    }

    leaveTo(path);
  }

  // The field behaves like a bank keypad: whatever the browser hands back is
  // reduced to its digits and re-rendered, so typing pushes cents to the left
  // and Backspace drops the last digit.
  function typeAmount(value: string) {
    update({ amount: amountDigitsToInput(amountInputToDigits(value)) });
  }

  function changeSplitValue(key: string, value: string) {
    if (draft.mode === "equal") {
      return;
    }

    update({ values: { ...draft.values, [draft.mode]: { ...draft.values[draft.mode], [key]: value } } });
  }

  async function save(sent: Attempt) {
    setAttempt(sent);
    setBusy(true);
    setError("");

    try {
      const saved = billing
        ? await request<BillingDetail>(`/api/financial/billings/${billing.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(sent.applyTo ? { ...patchBody(sent.input), applyTo: sent.applyTo } : patchBody(sent.input)),
          })
        : await request<BillingDetail>("/api/financial/billings", {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": sent.key },
            body: JSON.stringify(sent.input),
          });

      setAttempt(null);
      // Left busy on purpose: the caller navigates to the saved billing, and clearing it here
      // would flash the button back to idle while this screen is still on top.
      onSaved(saved);
    } catch (reason) {
      const status = (reason as { status?: number }).status;
      const uncertain = sent.uncertain || !status || status >= 500;

      setAttempt(uncertain ? { ...sent, uncertain: true } : null);
      setError((reason as Error).message);
      setBusy(false);
    }
  }

  /** The receiving contact travels only when the seat actually moved: resending it is a no-op the API still validates. */
  function seatPatch(input: BillingInput): Pick<BillingPatch, "contactId"> {
    return input.contactId && input.contactId !== billing?.contact?.id ? { contactId: input.contactId } : {};
  }

  function patchBody(input: BillingInput): BillingPatch {
    // A registro keeps its counterpart: it only recategorizes (and, while recorrente, moves its schedule and amount).
    if (input.kind === BillingKind.Record) {
      const named = { category: input.category };

      if (billing && billing.recurrence !== "indefinite") {
        return named;
      }

      return { description: input.description, totalCents: input.totalCents, startDate: input.startDate, dueRule: input.dueRule ?? BillingDueRule.Fixed, ...named };
    }

    // The API reads the direction off the receiving contact, and so does the patch: only a conta a pagar has one.
    const toPayable = Boolean(input.contactId);
    const editable = {
      paymentMethodId: input.paymentMethodId,
      clearPaymentMethod: !input.paymentMethodId,
      ...(toPayable ? seatPatch(input) : {}),
      reminders: input.reminders,
      category: input.category,
    };

    if (billing && billing.recurrence !== "indefinite") {
      return editable;
    }

    const split = toPayable ? {} : { split: input.split };

    return { description: input.description, totalCents: input.totalCents, startDate: input.startDate, dueRule: input.dueRule ?? BillingDueRule.Fixed, ...split, ...editable };
  }

  function applyScope(applyTo?: EditScope) {
    if (!scopeAttempt) {
      return;
    }

    const sent = applyTo ? { ...scopeAttempt, applyTo } : scopeAttempt;

    setScopeAttempt(null);
    void save(sent);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (locked && attempt) {
      void save(attempt);

      return;
    }

    try {
      // Never send "Não notificar" for a participant the agenda no longer shows as reachable: the
      // switch does not render for them, so a stale value seeded from editing must not travel either.
      const notify = draft.notify && Object.fromEntries(Object.entries(draft.notify).filter(([userId]) => notifiableIds.has(userId)));
      // Only a creation checks that a recorrente registro starts today or later.
      const next: Attempt = { input: buildBillingInput({ ...draft, notify }, billing ? undefined : new Date()), key: crypto.randomUUID(), uncertain: false };

      // Only a recorrente edit that changes what its charges carry, with charges of this month still ahead, needs the answer.
      if (billing && shouldAskEditScope(billing, patchBody(next.input), todayIn(billing.timezone))) {
        setScopeAttempt(next);

        return;
      }

      void save(next);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  const today = todayIn(draft.timezone);
  // Month ends exist for a single due date and for monthly rules; a yearly billing keeps a fixed day.
  const monthEnds = draft.type === "once" || draft.frequency === "monthly";
  const monthEnd = monthEnds && draft.dueRule === "end_of_month";
  // A recorrente registro starts today or later; a single one may be in the past.
  const minimumDate = settled && draft.type !== "once" ? today : undefined;

  function toggleMonthEnd() {
    if (monthEnd) {
      update({ dueRule: BillingDueRule.Fixed });

      return;
    }

    update({ dueRule: BillingDueRule.EndOfMonth, start: endOfMonth(draft.start && draft.start >= today ? draft.start : today) });
  }

  const totalCents = draftTotalCents(draft);
  const installmentPreview = untilInstallmentPreview(draft);
  const { amounts, error: hint } = previewBillingSplit(draft);

  /** The draft seats people by account; the chips and split rows look their agenda entry up by that id. */
  function contactFor(userId: string): Contact {
    return recent.find(contact => contact.userId === userId) ?? directory.find(contact => contact.userId === userId) ?? unknownContact(userId);
  }

  /** The counterpart seat holds the agenda entry itself, the way the API files keys and contas a pagar. */
  function contactById(id: string): Contact {
    const found = recent.find(contact => contact.id === id) ?? directory.find(contact => contact.id === id);

    if (found) {
      return found;
    }

    // An archived contact leaves the agenda but stays seated on the billing: the loaded detail still names them.
    const seat = billing?.contact;

    if (seat?.id === id) {
      return { ...unknownContact(seat.userId), id: seat.id, name: seat.name, displayName: seat.name, avatar: seat.avatar };
    }

    return unknownContact(id);
  }

  const chosen = draft.selected.map(userId => contactFor(userId));
  // Nothing reaches a contact without an e-mail or a phone, so the switch never shows for them.
  const notifiable = chosen.filter(canNotifyContact);
  const notifiableIds = new Set(notifiable.map(contact => contact.userId));

  function nameOf(key: string): string {
    if (key === "owner") {
      return "Eu";
    }

    return contactFor(key).displayName;
  }

  /** What the owner keeps on a fixed split: the preview's share, or the remainder of a half-typed screen. */
  function ownerRemainderCents(): number | null {
    const previewed = amounts.owner;

    if (previewed !== undefined) {
      return previewed;
    }

    if (!totalCents) {
      return null;
    }

    let used = 0;

    for (const userId of draft.selected) {
      const typed = draft.values.fixed[userId];

      if (!typed) {
        continue;
      }

      try {
        used += parseBRLCents(typed);
      } catch {
        return null;
      }
    }

    return used > totalCents ? null : totalCents - used;
  }

  const modeValues = draft.mode === "equal" ? NO_VALUES : draft.values[draft.mode];
  const rowParties: SplitParty[] = draft.mode === "fixed" ? draft.selected.map(userId => ({ kind: SplitPartKind.User, userId })) : splitParties(draft);
  const rows: SplitRow[] = rowParties.map(party => {
    const key = splitPartyKey(party);
    const cents = amounts[key];

    return {
      key,
      name: nameOf(key),
      avatar: key === "owner" ? null : contactFor(key).avatar,
      value: modeValues[key] ?? "",
      // A fixed row is the amount itself, so repeating it beside the field says nothing.
      amountText: draft.mode === "fixed" || cents === undefined ? "" : money(cents),
    };
  });

  const remainder = draft.mode === "fixed" && draft.owner ? ownerRemainderCents() : null;

  if (remainder !== null) {
    rows.push({ key: "owner", name: nameOf("owner"), value: "", amountText: "", readonlyText: `Você fica com ${money(remainder)}` });
  }

  const participants = draft.selected.length + (draft.owner ? 1 : 0);
  const perPerson = draft.mode === "equal" ? (Object.values(amounts)[0] ?? 0) : totalCents;

  /** The short status beside the split title: what the current mode is doing with the total. */
  function splitTag(): string {
    if (draft.mode === "equal") {
      return participants && totalCents ? `Automático (${money(perPerson)} cada)` : "Automático";
    }

    if (draft.mode === "shares") {
      const shares = rowParties.reduce((sum, party) => sum + (Number(modeValues[splitPartyKey(party)]) || 1), 0);

      return `${shares} cota${shares === 1 ? "" : "s"} no total`;
    }

    if (draft.mode === "percentage") {
      const percent = rowParties.reduce((sum, party) => sum + (Number((modeValues[splitPartyKey(party)] ?? "").replace(",", ".")) || 0), 0);

      return `${String(percent).replace(".", ",")}% distribuído`;
    }

    return "Valores manuais";
  }

  // A seat whose keys have not landed yet answers none, so the selector never offers another contact's.
  const payeeLoaded = payeeKeys.contactId === draft.payee;
  // The same selector serves both directions, over whichever keys pay this conta.
  const methods = payable ? (payeeLoaded ? payeeKeys.methods : []) : wallet;
  const selectedPix = methods.find(method => method.id === draft.pix) ?? null;
  // One registered key has nothing to switch to; the list only opens with a real choice.
  const switchable = methods.length > 1 || (methods.length === 1 && !selectedPix);
  // Who sits on the other side: the contact a conta a pagar pays, or the single person who paid a registro a receber.
  const seatId = payable ? draft.payee : (draft.selected[0] ?? "");
  const seated = seatId ? (payable ? contactById(seatId) : contactFor(seatId)) : null;
  // A locked seat is not a toggle: it announces no pressed state and offers no remove hint.
  const chipToggle = seatLocked ? {} : { "aria-pressed": true, title: "Remove quem está do outro lado" };
  const action = editing ? "Salvar conta" : "Criar conta";
  // Only meaningful on create: an edit patches a subset of fields, not the whole draft.
  const draftSummary = editing ? null : billingDraftSummary(draft, new Date());

  function scopeExplanation(detail: BillingDetail): string {
    const today = todayIn(detail.timezone);

    return editScopeExplanation(editableMonthCharges(detail, today).length, today);
  }

  return (
    <form className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-4 pb-6 md:max-w-4xl" onSubmit={submit}>
      {frozen && <p className="m-0 rounded-2xl bg-primary-soft/50 p-4 text-sm text-primary-strong">{FROZEN_NOTE}</p>}

      {/* Direção */}
      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={locked || editing}>
        <div className="flex gap-2" role="radiogroup" aria-label="Direção">
          {DIRECTIONS.map(option => {
            const active = draft.direction === option.value;

            return (
              <label
                key={option.value}
                className={`flex min-h-[38px] flex-1 cursor-pointer items-center justify-center rounded-xl border text-[13px] font-bold ${
                  active ? "border-primary bg-primary text-on-primary" : "border-outline bg-surface text-muted"
                }`}
              >
                <input type="radio" className="sr-only" name="billing-direction" value={option.value} checked={active} onChange={() => pickDirection(option.value)} />
                {option.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Registro: already received or paid. On edit it only shows on a registro, locked. */}
      {(!editing || settled) && (
        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface p-3">
            <span className="flex min-w-0 flex-col">
              <span className="text-xs font-semibold text-ink">{SETTLED_LABELS[draft.direction].toggle}</span>
              {editing && <span className="text-[11px] text-muted">{SETTLED_LOCKED}</span>}
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label={SETTLED_LABELS[draft.direction].toggle}
              className="h-5 w-5 accent-primary"
              disabled={locked || editing}
              checked={settled}
              onChange={event => update({ settled: event.target.checked })}
            />
          </label>
          {settled && <p className="m-0 text-[11px] text-muted">{SETTLED_HELP}</p>}
        </div>
      )}

      {/* Without a key there is nothing to send: the form waits behind a single call to action. */}
      {gate ? (
        <section className="flex flex-col items-center gap-3 rounded-3xl border border-outline/40 bg-surface px-6 py-10 text-center" role="status">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft/60 text-primary-strong">
            <KeyRound size={26} aria-hidden="true" />
          </span>
          <h2 className="m-0 text-xl font-bold text-primary-strong">{PIX_GATE_TITLE}</h2>
          <p className="m-0 max-w-sm text-sm leading-5 text-muted">{PIX_GATE_NOTE}</p>
          <button type="button" className="mt-2 h-12 w-full max-w-sm rounded-xl bg-primary font-bold text-on-primary" onClick={() => leaveTo(PIX_SETUP)}>
            Cadastrar meio de pagamento
          </button>
        </section>
      ) : (
        <>
      {!ready && !error && <p className="m-0 text-muted" role="status">Carregando dados…</p>}

      <div className="grid min-w-0 gap-4 md:grid-cols-2 md:items-start">
      <div className="flex min-w-0 flex-col gap-4">

      {/* Valor */}
      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={locked || frozen}>
        <Card>
          <label htmlFor="billing-amount" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            {AMOUNT_LABELS[draft.type]}
          </label>
          <div className="flex items-baseline gap-1.5">
            <span aria-hidden="true" className="font-display text-base font-medium text-muted">
              R$
            </span>
            <input
              id="billing-amount"
              inputMode="numeric"
              placeholder="0,00"
              value={formatAmountDigits(amountInputToDigits(draft.amount))}
              onChange={event => typeAmount(event.target.value)}
              className="w-full min-w-0 border-0 bg-transparent p-0 font-display text-[30px] font-bold leading-none tracking-[-0.02em] text-ink tabular-nums outline-none disabled:opacity-60"
            />
          </div>
          {installmentPreview && (
            <p className="m-0 text-[11px] text-muted">
              {installmentPreview.count}x de {money(installmentPreview.perInstallmentCents)}
              {installmentPreview.roundedUp ? ` · total ${money(installmentPreview.totalCents)}` : ""}
            </p>
          )}
        </Card>
      </fieldset>

      {/* Título e categoria */}
      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={locked}>
        <div className="flex flex-col gap-1">
          <SectionLabel htmlFor="billing-title">Título da conta</SectionLabel>
          <input
            id="billing-title"
            aria-label="Título"
            maxLength={500}
            placeholder="Ex: Aluguel do sítio, Pizzaria..."
            disabled={frozen}
            value={draft.description}
            onChange={event => update({ description: event.target.value })}
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>Categoria</span>
          <CategorySelect
            value={draft.category}
            disabled={locked}
            onSelect={category => update({ category, description: draft.description || billingCategoryLabel(category) })}
          />
        </div>
      </fieldset>

      {/* Frequência: modalidade de pagamento + vencimento */}
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={locked || scheduled}>
        <span className={LABEL_CLASS}>Modalidade de Pagamento</span>
        <div className="flex gap-2" role="radiogroup" aria-label="Modalidade">
          {TYPES.map(option => {
            const active = draft.type === option.value;

            return (
              <label
                key={option.value}
                className={`flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-xl border px-2 text-[13px] ${
                  active ? "border-primary bg-primary-soft font-bold text-primary-strong" : "border-outline bg-surface font-semibold text-muted"
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name="billing-type"
                  value={option.value}
                  checked={active}
                  onChange={() => update({ type: option.value, frequency: option.value === "until" ? BillingFrequency.Monthly : draft.frequency, end: "" })}
                />
                {option.label}
              </label>
            );
          })}
        </div>
        {draft.type === "until" && (
          <div className="flex flex-col gap-1">
            <SectionLabel htmlFor="billing-occurrences">Parcelas</SectionLabel>
            <input
              id="billing-occurrences"
              type="number"
              min={2}
              max={120}
              inputMode="numeric"
              placeholder="2 a 120"
              value={draft.occurrences}
              onChange={event => update({ occurrences: event.target.value })}
              className={INPUT_CLASS}
            />
          </div>
        )}
        {draft.type === "indefinite" && (
          <div className="flex flex-col gap-1">
            <SectionLabel htmlFor="billing-frequency">Frequência</SectionLabel>
            <select id="billing-frequency" value={draft.frequency} onChange={event => update({ frequency: event.target.value as BillingFrequency })} className={INPUT_CLASS}>
              <option value="monthly">Mensal</option>
              <option value="yearly">Anual</option>
            </select>
          </div>
        )}
      </fieldset>

      {/* Vencimento */}
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={locked || dueLocked}>
        <SectionLabel htmlFor={monthEnd ? undefined : "billing-start"}>{scheduled ? "Próximo vencimento" : "Data de Vencimento"}</SectionLabel>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {monthEnd ? (
              <MonthSelect value={draft.start} today={today} disabled={locked || dueLocked} onSelect={value => update({ start: value })} />
            ) : (
              <input
                id="billing-start"
                aria-label="Vencimento"
                type="date"
                min={minimumDate}
                value={draft.start}
                onChange={event => update({ start: event.target.value })}
                className="h-11 w-full rounded-xl border border-outline/50 bg-surface px-3.5 text-[14px] font-semibold text-ink disabled:opacity-60"
              />
            )}
          </div>
          <button
            type="button"
            aria-pressed={!monthEnd && draft.start === today}
            onClick={() => update({ start: addCalendarDays(today, 0), dueRule: BillingDueRule.Fixed })}
            className={`h-11 shrink-0 rounded-xl border px-3.5 text-xs font-semibold text-primary-strong disabled:opacity-50 ${
              !monthEnd && draft.start === today ? "border-primary/30 bg-primary-soft/60" : "border-outline/40 bg-surface-muted"
            }`}
          >
            Hoje
          </button>
          {monthEnds && (
            <button
              type="button"
              aria-pressed={monthEnd}
              onClick={toggleMonthEnd}
              className={`h-11 shrink-0 rounded-xl border px-3.5 text-xs font-semibold text-primary-strong disabled:opacity-50 ${
                monthEnd ? "border-primary/30 bg-primary-soft/60" : "border-outline/40 bg-surface-muted"
              }`}
            >
              Final do mês
            </button>
          )}
        </div>
      </fieldset>

      </div>
      <div className="flex min-w-0 flex-col gap-4">

      {/* Quem está do outro lado: o contato que recebe uma conta a pagar, ou quem pagou um registro a receber */}
      {(payable || settled) && (
        <fieldset className="relative m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={locked || frozen}>
          {/* The legend names the whole seat, so it stays the fieldset's first child; Escolher shares its line. */}
          <legend className={`${LABEL_CLASS} p-0 leading-10`}>{SETTLED_LABELS[draft.direction].field}</legend>
          {!seatLocked && (
            <button
              type="button"
              ref={pickPayee}
              onClick={() => setPayeePicker(true)}
              className="absolute right-0 top-0 flex min-h-10 items-center gap-1 bg-transparent px-1 text-xs font-semibold text-primary"
            >
              <Plus size={14} aria-hidden="true" />
              {seated ? "Trocar" : "Escolher"}
            </button>
          )}

          {seated ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-label={seated.displayName}
                {...chipToggle}
                disabled={seatLocked}
                onClick={clearSeat}
                className="flex items-center gap-1.5 rounded-full border border-outline/40 bg-surface py-1 pl-1 pr-2"
              >
                <InitialsAvatar name={seated.displayName} size={24} avatar={seated.avatar} />
                <span className="text-xs font-semibold text-ink">{seated.displayName}</span>
                {!seatLocked && <X size={12} aria-hidden="true" className="text-muted" />}
              </button>
            </div>
          ) : (
            <p className="m-0 text-[11px] text-muted">{SEAT_HINTS[draft.direction]}</p>
          )}
        </fieldset>
      )}

      {payeePicker && (
        <ContactPickerSheet
          selected={seatId ? [seatId] : []}
          by={payable ? "id" : "userId"}
          returnFocusTo={pickPayee}
          onToggle={seat}
          onSeen={remember}
          onClose={() => setPayeePicker(false)}
          onNew={
            editing
              ? undefined
              : () => {
                  setPayeePicker(false);
                  leaveTo(NEW_CONTACT);
                }
          }
        />
      )}

      {/* Divisão: mode tabs, participant list, Adicionar below it, then Não notificar and Eu também participo */}
      {!payable && !settled && (
      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={locked || frozen}>
        <Card>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Divisão da Conta</span>
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-muted">
                {participants} pessoa{participants === 1 ? "" : "s"}
              </span>
            </div>
            <span className="truncate text-[11.5px] font-semibold text-success">{splitTag()}</span>
          </div>

          {chosen.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chosen.map(contact => (
                <button
                  key={contact.userId}
                  type="button"
                  aria-label={contact.displayName}
                  aria-pressed="true"
                  title="Remove da cobrança"
                  onClick={() => toggle(contact.userId)}
                  className="flex items-center gap-1.5 rounded-full border border-outline/40 bg-surface py-1 pl-1 pr-2"
                >
                  <InitialsAvatar name={contact.displayName} size={24} avatar={contact.avatar} />
                  <span className="text-xs font-semibold text-ink">{contact.displayName}</span>
                  <X size={12} aria-hidden="true" className="text-muted" />
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-1.5" role="radiogroup" aria-label="Divisão">
            {SPLIT_MODES.map(option => {
              const active = draft.mode === option.value;

              return (
                <label
                  key={option.value}
                  className={`flex min-h-[30px] cursor-pointer items-center justify-center rounded-[9px] px-3 text-xs ${
                    active ? "bg-ink font-bold text-surface" : "bg-surface-muted font-semibold text-muted"
                  }`}
                >
                  <input type="radio" className="sr-only" name="billing-split" value={option.value} aria-label={option.name} checked={active} onChange={() => update({ mode: option.value })} />
                  <span aria-hidden="true">{option.label}</span>
                </label>
              );
            })}
          </div>
          <SplitEditor mode={draft.mode} rows={rows} hint={hint ?? ""} disabled={locked || frozen} onChange={changeSplitValue} />
        </Card>

        <button
          type="button"
          ref={addContact}
          aria-label="Adicionar"
          onClick={() => setPicker(true)}
          className="flex min-h-10 items-center gap-2 self-start bg-transparent px-1 text-xs font-semibold text-primary"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-primary">
            <Plus size={13} aria-hidden="true" />
          </span>
          Adicionar pessoa
        </button>

        {notifiable.length > 0 && (
          <div className="flex flex-col gap-2">
            {notifiable.map(contact => (
              <label key={contact.userId} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface px-3 py-2.5">
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  <InitialsAvatar name={contact.displayName} size={24} avatar={contact.avatar} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-semibold text-ink">{contact.displayName}</span>
                    <span className="text-[11px] text-muted">Não notificar</span>
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`Não notificar ${contact.displayName}`}
                  className="h-5 w-5 accent-primary"
                  checked={draft.notify?.[contact.userId] === false}
                  onChange={event => switchNotify(contact.userId, !event.target.checked)}
                />
              </label>
            ))}
            <p className="m-0 text-[11px] text-muted">Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.</p>
          </div>
        )}

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface-muted/80 p-3">
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface">
              <InitialsAvatar name="Eu" size={20} inverted />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-xs font-semibold text-ink">Eu também participo da divisão</span>
              <span className="text-[11px] text-muted">Você entra no cálculo como um dos pagadores</span>
            </span>
          </span>
          <input type="checkbox" aria-label="Eu também participo" className="h-5 w-5 accent-primary" checked={draft.owner} onChange={event => update({ owner: event.target.checked })} />
        </label>
      </fieldset>
      )}

      {picker && (
        <ContactPickerSheet
          selected={draft.selected}
          returnFocusTo={addContact}
          onToggle={contact => toggle(contact.userId)}
          onSeen={remember}
          onClose={() => setPicker(false)}
          onNew={
            editing
              ? undefined
              : () => {
                  setPicker(false);
                  leaveTo(NEW_CONTACT);
                }
          }
        />
      )}

      {/* Pix: the owner's own keys on a conta a receber, the seated contact's on a conta a pagar */}
      {!settled && (!payable || Boolean(draft.payee)) && (
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={locked}>
        <div className="flex items-center justify-between">
          <span className={LABEL_CLASS}>{payable ? "Pagar via Pix" : "Receber por"}</span>
          {!payable && !editing && !gate && (
            <button type="button" aria-label="Cadastrar chave" onClick={() => leaveTo(PIX_SETUP)} className="min-h-8 bg-transparent text-[11px] font-medium text-primary">
              + Cadastrar meio de pagamento
            </button>
          )}
        </div>
        {payable && payeeLoaded && !methods.length ? (
          <div className="flex flex-col items-start gap-2 rounded-xl border border-outline/40 bg-surface p-3" role="status">
            <p className="m-0 text-xs leading-5 text-muted">{NO_CONTACT_KEY}</p>
            <button type="button" onClick={leaveToContactKeys} className="min-h-9 bg-transparent px-0 text-xs font-bold text-primary">
              Cadastrar chave
            </button>
          </div>
        ) : (
        <div className="relative">
          <button
            type="button"
            aria-expanded={pixOpen}
            aria-controls="billing-pix-options"
            disabled={!switchable}
            onClick={() => setPixOpen(open => !open)}
            className="flex w-full items-center justify-between rounded-xl border border-outline/40 bg-surface p-3 text-left disabled:cursor-default"
          >
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-strong">
                <ProviderIcon method={selectedPix ?? { provider: PaymentProvider.Pix, kind: PixKeyType.Random }} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-semibold text-ink">
                  {selectedPix ? `${paymentMethodText(selectedPix).title}: ${abbreviate(paymentMethodText(selectedPix).value)}` : "Selecionar meio de pagamento"}
                </span>
                <span className="truncate text-[11px] text-muted">
                  {selectedPix ? (selectedPix.isDefault ? "Meio padrão" : "Meio secundário") : methods.length ? "Clique para escolher" : "Nenhum meio cadastrado"}
                </span>
              </span>
            </span>
            {switchable && <ChevronDown size={16} aria-hidden="true" className="text-muted" />}
          </button>
          {pixOpen && (
            <ul id="billing-pix-options" role="listbox" aria-label="Meio de pagamento" className="absolute left-0 right-0 top-full z-20 m-0 mt-2 flex list-none flex-col gap-2 rounded-2xl border border-outline/40 bg-canvas p-3 shadow-xl">
              {methods.map(method => {
                const active = draft.pix === method.id;
                const text = paymentMethodText(method);

                return (
                  <li key={method.id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => {
                        update({ pix: method.id });
                        setPixOpen(false);
                      }}
                      className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left ${active ? "border-primary bg-primary-soft/40" : "border-outline/40 bg-surface"}`}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-strong">
                        <ProviderIcon method={method} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-ink">{text.title}</span>
                          {method.isDefault && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-muted">Padrão</span>}
                        </span>
                        <span className="truncate text-[11px] text-muted">{text.value}</span>
                      </span>
                      {active && <Check size={18} aria-hidden="true" className="text-primary-strong" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        )}
      </fieldset>
      )}

      </div>
      </div>

      {error && <p className="m-0 rounded-xl bg-danger-soft p-4 text-danger" role="alert">{error}</p>}

      <ScreenFooter className="-mx-1 border-t border-outline/30 bg-canvas/95 px-1 pb-2 pt-4 backdrop-blur-md">
        {busy && <p className="m-0 mb-2 text-sm text-muted" role="status">Salvando…</p>}
        {/* Only on create: an edit patches a subset of fields, so the full draft summary would not match what is actually sent. */}
        {!editing && draftSummary && (
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <span className="text-[13px] text-muted">{billingDraftSummaryText(draftSummary)}</span>
            <strong className="font-display text-[13px] font-bold text-ink tabular-nums">
              {draftSummary.occurrences === null ? `${money(draftSummary.perOccurrenceCents)}/mês` : money(draftSummary.totalCents)}
            </strong>
          </div>
        )}
        {attempt?.uncertain ? (
          <button type="submit" className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-outline bg-transparent text-sm font-bold text-primary" disabled={busy}>
            {busy && <Loader2 aria-hidden="true" size={18} className="animate-spin" />}
            Tentar novamente
          </button>
        ) : (
          <button type="submit" className="flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-ink text-[15px] font-bold text-surface disabled:opacity-50" disabled={busy || !totalCents}>
            {busy && <Loader2 aria-hidden="true" size={18} className="animate-spin" />}
            {action}
          </button>
        )}
      </ScreenFooter>
        </>
      )}

      {scopeAttempt && billing && (
        <ScopeDialog
          title="Aplicar às cobranças deste mês?"
          icon={CalendarClock}
          explanation={scopeExplanation(billing)}
          primaryLabel="Aplicar também às deste mês"
          secondaryLabel="Só a partir do mês seguinte"
          busy={busy}
          onPrimary={() => applyScope(EditScope.CurrentMonth)}
          onSecondary={() => applyScope()}
          onCancel={() => setScopeAttempt(null)}
        />
      )}
    </form>
  );
}
