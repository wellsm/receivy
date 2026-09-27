"use client";

import {
  billingCategoryColor,
  billingCategoryLabel,
  buildBillingInput,
  calendarDate,
  canNotifyContact,
  draftTotalCents,
  editableMonthCharges,
  editScopeExplanation,
  EMPTY_BILLING_DRAFT,
  EMPTY_SPLIT_VALUES,
  directionLine,
  firstNoticeDate,
  firstNoticeSentence,
  groupFirstNoticeSentence,
  formatMoney,
  parseBRLCents,
  planErrorOf,
  previewBillingSplit,
  receiptSentence,
  reminderRowLabel,
  reminderSummary,
  repetitionLabel,
  shouldAskEditScope,
  splitCountLabel,
  splitFooterLine,
  splitSummaryLine,
  splitParties,
  splitPartyKey,
  untilInstallmentPreview,
  UserStatus,
  WhatsappInstanceState,
  BillingDueRule,
  BillingFrequency,
  BillingKind,
  BillingRecurrence,
  dayMonth,
  Direction,
  EditScope,
  paymentMethodText,
  PlanTier,
  SplitPartKind,
  SYSTEM_REMINDER_CONFIG,
  type BillingDetail,
  type BillingDraft,
  type BillingInput,
  type BillingPatch,
  type Contact,
  type ContactsPage,
  type PaymentMethod,
  type PaymentMethodsPage,
  type PlanErrorPayload,
  type ReminderRule,
  type ReminderSettings,
  type SplitLine,
  type SplitValues,
  type WhatsappGroup,
  type WhatsappSettings,
} from "@receivy/common";
import {
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronLeft,
  KeyRound,
  Loader2,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { saveDraft, takeDraft, type StoredDraft } from "@/lib/billing-draft";
import { responseMessage } from "@/lib/financial-response";
import { loadPlanSummary } from "@/lib/plan-summary";
import { visibleChannels, whatsappEnabled } from "@/lib/whatsapp-flag";
import { BillingDialog } from "@/components/app/billing-dialog";
import { ContactPickerSheet } from "@/components/app/contact-picker-sheet";
import { PlanPaywall } from "@/components/app/plan-paywall";
import {
  ReminderEditor,
  ReminderPreview,
} from "@/components/app/reminder-editor";
import { ScopeDialog } from "@/components/app/scope-dialog";
import { WhatsappGroupDialog } from "@/components/app/whatsapp-group-dialog";
import { CategoryIcon } from "@/components/ui/category-icon";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { ScreenFooter } from "@/components/ui/screen-footer";
import { DetailCard, DetailRow } from "./billing/detail-row";
import {
  AmountTitleFields,
  DIRECTIONS,
  LABEL_CLASS,
  RepeatFields,
  Segmented,
  SETTLED_LABELS,
} from "./billing/schedule-fields";
import { SeatPanel, SplitPanel, type SplitPerson } from "./billing/split-panel";

type Attempt = {
  input: BillingInput;
  key: string;
  uncertain: boolean;
  applyTo?: EditScope;
};
/** Which panel is lifted over the screen: the edit opens every row in one, the creation the two defaults. */
type Panel = "repeat" | "split" | "reminders" | "pix" | "group" | null;
/** Below `md` a creation goes one column at a time, like the app; wider screens show all three. */
type Step = 1 | 2 | 3;

type BillingFormScreenProps = {
  billing: BillingDetail | null;
  onSaved: (billing: BillingDetail) => void;
};

const RETURN_TO = "/billings/new";
const PIX_SETUP = `/settings/payment-methods/new?returnTo=${encodeURIComponent(RETURN_TO)}&required=1`;
const NEW_CONTACT = `/contacts/new?returnTo=${encodeURIComponent(RETURN_TO)}`;
const FROZEN_NOTE = "Contas já geradas só permitem categoria, Pix e lembretes.";
const PIX_GATE_TITLE = "Cadastre um meio de pagamento";
const PIX_GATE_NOTE =
  "Uma conta a receber gera um link de pagamento com o seu Pix, sua InfinitePay ou seu PagBank. Cadastre um e volte para continuar de onde parou.";
const NO_CONTACT_KEY =
  "Este contato ainda não tem chave Pix. Cadastre no contato.";
const NO_VALUES: Record<string, string> = {};
const SETTLED_HELP =
  "Registro já quitado: ninguém recebe aviso. Cada ocorrência fica paga no vencimento.";
const SETTLED_LOCKED = "Não dá para mudar depois de criada.";
const STEP_TITLES: Record<Step, string> = {
  1: "O quê e quando",
  2: "Divisão",
  3: "Revisar",
};
const CONTINUE_LABELS: Record<Step, string> = {
  1: "Continuar · divisão",
  2: "Continuar · revisar",
  3: "",
};

/** The counterpart seat, by direction: a conta a pagar names who receives, a registro who paid. */
const SEAT_LABELS: Record<Direction, string> = {
  receivable: "De quem",
  payable: "Para quem",
};
const SEAT_HINTS: Record<Direction, string> = {
  receivable: "Escolha quem pagou.",
  payable: "Escolha quem recebe.",
};

/** The plan's 402: the save catch branches on it instead of showing the generic save error. */
class PlanError extends Error {
  constructor(readonly plan: PlanErrorPayload) {
    super(plan.message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await browserFetch(path, init);

  if (!response.ok) {
    const payload = await response
      .clone()
      .json()
      .catch(() => null);
    const planError = planErrorOf(payload);

    if (planError) {
      throw new PlanError(planError);
    }

    const error = new Error(
      await responseMessage(
        response,
        "Não foi possível salvar. Tente novamente.",
      ),
    );

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

/** Each participant's current bell, so saving the edit sends back what the billing already has. */
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
    selected: parts.flatMap((part) =>
      part.kind === "user" ? [part.userId] : [],
    ),
    owner:
      parts.some((part) => part.kind === "owner") ||
      billing.split.mode === "fixed",
    // Parcelado: the form shows the total, so saving it unchanged rebuilds the same per-installment amount.
    amount: moneyText(
      billing.recurrence === BillingRecurrence.Until
        ? billing.total.amountCents * (billing.installmentCount ?? 1)
        : billing.total.amountCents,
    ),
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
    reminders: billing.reminders
      ? billing.reminders.map((reminder) => ({
          ...reminder,
          offsetDays: String(reminder.offsetDays),
        }))
      : null,
    notify: notifyFromBilling(billing),
    settled: billing.kind === BillingKind.Record,
    whatsappGroup: billing.whatsappGroup ?? null,
  };
}

/** A participant the agenda no longer lists (archived, or another owner's contact): the row still needs a name. */
function unknownContact(userId: string): Contact {
  return {
    id: userId,
    userId,
    name: "Contato",
    nickname: null,
    displayName: "Contato",
    email: "",
    phone: null,
    phoneSource: null,
    whatsappConsentAt: null,
    status: UserStatus.Pending,
    archivedAt: null,
    createdAt: "",
    lastBilledAt: null,
    activeCharges: 0,
  };
}

function abbreviate(pixKey: string): string {
  return pixKey.length <= 18
    ? pixKey
    : `${pixKey.slice(0, 7)}…${pixKey.slice(-7)}`;
}

/** The typed amount, or zero while it cannot be read: a parcelado still types its total here. */
function typedCents(draft: BillingDraft): number {
  try {
    return parseBRLCents(draft.amount);
  } catch {
    return 0;
  }
}

/** Shows a creation column only on its own step below `md`; wider screens show them all. */
function stepClass(current: Step, own: Step): string {
  return current === own ? "flex" : "hidden md:flex";
}

function Card({ children }: { children: ReactNode }) {
  return (
    // Below `md` the step is the screen itself (6a/6b/6e): the column card only exists in the three columns (6f).
    <div className="flex flex-col gap-4 md:rounded-[20px] md:border md:border-outline md:bg-surface md:p-4">
      {children}
    </div>
  );
}

/** The numbered heading of a creation column. */
function ColumnTitle({
  number,
  children,
  trailing,
}: {
  number: number;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    // Below `md` the step header already names the step.
    <div className="hidden min-h-7 items-center justify-between gap-2 md:flex">
      <h2 className="m-0 flex items-center gap-2 text-[15px] font-bold text-ink">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-surface"
          aria-hidden="true"
        >
          {number}
        </span>
        {children}
      </h2>
      {trailing}
    </div>
  );
}

export function BillingFormScreen({
  billing,
  onSaved,
}: BillingFormScreenProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<BillingDraft>(() =>
    billing
      ? draftFromBilling(billing)
      : EMPTY_BILLING_DRAFT("America/Sao_Paulo", calendarDate()),
  );
  const [panel, setPanel] = useState<Panel>(null);
  const [step, setStep] = useState<Step>(1);
  const [recent, setRecent] = useState<Contact[]>([]);
  const [directory, setDirectory] = useState<Contact[]>([]);
  /** The owner's own keys: what a conta a receber is paid through. */
  const [wallet, setWallet] = useState<PaymentMethod[]>([]);
  /** The seated contact's keys, tagged with whose they are: an unanswered seat reads as none. */
  const [payeeKeys, setPayeeKeys] = useState<{
    contactId: string;
    methods: PaymentMethod[];
  }>({ contactId: "", methods: [] });
  const [picker, setPicker] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [scopeAttempt, setScopeAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [gated, setGated] = useState(false);
  const [paywall, setPaywall] = useState<PlanErrorPayload | null>(null);
  // What actually fires while the draft inherits the default: the billing's own on edit, the
  // owner's account default on creation (fetched below, falling back to the system default).
  const [effective, setEffective] = useState<ReminderRule[]>(
    () => billing?.effectiveReminders ?? SYSTEM_REMINDER_CONFIG.reminders,
  );
  const [plan, setPlan] = useState<PlanTier>(PlanTier.Free);
  const restored = useRef<StoredDraft | null>(null);
  const addContact = useRef<HTMLButtonElement>(null);
  const pickPayee = useRef<HTMLButtonElement>(null);
  const repeatRow = useRef<HTMLButtonElement>(null);
  const splitRow = useRef<HTMLButtonElement>(null);
  const remindersRow = useRef<HTMLButtonElement>(null);
  const pixRow = useRef<HTMLButtonElement>(null);
  const groupRow = useRef<HTMLButtonElement>(null);
  // Groups go through the owner's own number: the option only shows while it is connected.
  const [groupsReady, setGroupsReady] = useState(false);

  useEffect(() => {
    let live = true;

    request<WhatsappSettings>("/api/financial/whatsapp")
      .then((settings) => {
        if (live) {
          setGroupsReady(
            settings.ownAvailable &&
              settings.instance?.state === WhatsappInstanceState.Open,
          );
        }
      })
      .catch(() => {
        // No settings, no group option: each person is notified as before.
      });

    return () => {
      live = false;
    };
  }, []);

  const loadGroups = useCallback(
    (participants: string[]) =>
      request<{ groups: WhatsappGroup[] }>(
        `/api/financial/whatsapp/groups?participants=${encodeURIComponent(participants.join(","))}`,
      ).then((body) => body.groups),
    [],
  );

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
  // Who sits on the other side: the contact a conta a pagar pays, or the single person who paid a registro a receber.
  const seating = payable || settled;

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
      request<{ paymentMethods: PaymentMethod[] }>(
        "/api/financial/payment-methods",
      ),
      billing || stored
        ? Promise.resolve(null)
        : request<{ user: { timezone: string } }>("/api/auth/me"),
    ])
      .then(([agenda, keys, me]) => {
        if (!live) {
          return;
        }

        const active = keys.paymentMethods.filter(
          (method) => !method.archivedAt,
        );

        setRecent(agenda.contacts.slice(0, 12));
        setDirectory(agenda.contacts);
        setWallet(active);
        setGated(!billing && !active.length);

        if (stored?.step === 2 || stored?.step === 3) {
          setStep(stored.step);
        }

        setDraft((current) => {
          const base = stored ? stored.draft : current;
          const pix =
            billing || stored
              ? base.pix
              : (active.find((method) => method.isDefault)?.id ?? base.pix);

          return {
            ...base,
            pix,
            ...(me
              ? { timezone: me.user.timezone, start: todayIn(me.user.timezone) }
              : {}),
          };
        });
        setReady(true);
      })
      .catch((reason) => {
        if (!live) {
          return;
        }

        setDraft((current) => (stored ? stored.draft : current));
        setError((reason as Error).message);
      });

    return () => {
      live = false;
    };
  }, [billing]);

  useEffect(() => {
    void loadPlanSummary().then((summary) => {
      if (summary) {
        setPlan(summary.plan);
      }
    });
  }, []);

  useEffect(() => {
    // Editing already carries the billing's own effective reminders; a creation has none yet, so
    // the inherited summary reads the owner's account default, falling back to the system one.
    if (billing) {
      return;
    }

    let live = true;

    void request<ReminderSettings>("/api/financial/account/reminders")
      .then((settings) => {
        if (live) {
          setEffective(settings.config.reminders);
        }
      })
      .catch(() => {
        // Keeps the system default already set.
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

    void request<PaymentMethodsPage>(
      `/api/financial/payment-methods?contactId=${contactId}`,
    )
      .then((page) => {
        if (!live) {
          return;
        }

        const methods = page.paymentMethods.filter(
          (method) => !method.archivedAt,
        );

        setPayeeKeys({ contactId, methods });
        // A key of the contact the seat just left cannot pay this one: fall back to their
        // default. A seeded edit already points at one of these, and keeps it.
        setDraft((current) => ({
          ...current,
          pix: methods.some((method) => method.id === current.pix)
            ? current.pix
            : (methods.find((method) => method.isDefault)?.id ??
              methods[0]?.id ??
              ""),
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
    setDraft((current) => ({ ...current, ...patch }));
  }

  function toggle(userId: string) {
    update({
      selected: draft.selected.includes(userId)
        ? draft.selected.filter((id) => id !== userId)
        : [...draft.selected, userId],
    });
  }

  /** The bell of a participant: off means "Não notificar", which the draft stores as `false`. */
  function switchNotify(userId: string, notify: boolean) {
    update({ notify: { ...draft.notify, [userId]: notify } });
  }

  /** The counterpart seat holds one contact: picking another replaces it, picking the seated one empties it. */
  function seat(contact: Contact) {
    if (payable) {
      update({ payee: draft.payee === contact.id ? "" : contact.id });

      return;
    }

    update({
      selected: draft.selected[0] === contact.userId ? [] : [contact.userId],
    });
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
    update({
      direction,
      pix:
        direction === Direction.Payable
          ? ""
          : (wallet.find((item) => item.isDefault)?.id ?? ""),
    });
  }

  const remember = useCallback((contacts: Contact[]) => {
    setDirectory((current) => [
      ...current,
      ...contacts.filter(
        (contact) => !current.some((known) => known.id === contact.id),
      ),
    ]);
  }, []);

  function leaveTo(path: string) {
    saveDraft(draft, RETURN_TO, step);
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

  function changeSplitValue(key: string, value: string) {
    if (draft.mode === "equal") {
      return;
    }

    update({
      values: {
        ...draft.values,
        [draft.mode]: { ...draft.values[draft.mode], [key]: value },
      },
    });
  }

  async function save(sent: Attempt) {
    setAttempt(sent);
    setBusy(true);
    setError("");

    try {
      const saved = billing
        ? await request<BillingDetail>(
            `/api/financial/billings/${billing.id}`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(
                sent.applyTo
                  ? { ...patchBody(sent.input), applyTo: sent.applyTo }
                  : patchBody(sent.input),
              ),
            },
          )
        : await request<BillingDetail>("/api/financial/billings", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": sent.key,
            },
            body: JSON.stringify(sent.input),
          });

      setAttempt(null);
      // Left busy on purpose: the caller navigates to the saved billing, and clearing it here
      // would flash the button back to idle while this screen is still on top.
      onSaved(saved);
    } catch (reason) {
      // The plan's 402 keeps the draft as-is and skips the retry flow: the person comes
      // back to the same form after subscribing, or picks a smaller ask.
      if (reason instanceof PlanError) {
        setAttempt(null);
        setPaywall(reason.plan);
        setBusy(false);

        return;
      }

      const status = (reason as { status?: number }).status;
      const uncertain = sent.uncertain || !status || status >= 500;

      setAttempt(uncertain ? { ...sent, uncertain: true } : null);
      setError((reason as Error).message);
      setBusy(false);
    }
  }

  /** The receiving contact travels only when the seat actually moved: resending it is a no-op the API still validates. */
  /** The group travels only when it changed: a new one, or none where there was one. */
  function groupPatch(
    input: BillingInput,
  ): Pick<BillingPatch, "whatsappGroup" | "clearWhatsappGroup"> {
    const before = billing?.whatsappGroup ?? null;

    if (input.whatsappGroup && input.whatsappGroup.jid !== before?.jid) {
      return { whatsappGroup: input.whatsappGroup };
    }

    return !input.whatsappGroup && before ? { clearWhatsappGroup: true } : {};
  }

  function seatPatch(input: BillingInput): Pick<BillingPatch, "contactId"> {
    return input.contactId && input.contactId !== billing?.contact?.id
      ? { contactId: input.contactId }
      : {};
  }

  function patchBody(input: BillingInput): BillingPatch {
    // A registro keeps its counterpart: it only recategorizes (and, while recorrente, moves its schedule and amount).
    if (input.kind === BillingKind.Record) {
      const named = { category: input.category };

      if (billing && billing.recurrence !== "indefinite") {
        return named;
      }

      return {
        description: input.description,
        totalCents: input.totalCents,
        startDate: input.startDate,
        dueRule: input.dueRule ?? BillingDueRule.Fixed,
        ...named,
      };
    }

    // The API reads the direction off the receiving contact, and so does the patch: only a conta a pagar has one.
    const toPayable = Boolean(input.contactId);
    const editable = {
      paymentMethodId: input.paymentMethodId,
      clearPaymentMethod: !input.paymentMethodId,
      ...(toPayable ? seatPatch(input) : {}),
      ...(input.reminders
        ? { reminders: input.reminders }
        : billing?.reminders
          ? { clearReminders: true }
          : {}),
      ...groupPatch(input),
      category: input.category,
    };

    if (billing && billing.recurrence !== "indefinite") {
      return editable;
    }

    const split = toPayable ? {} : { split: input.split };

    return {
      description: input.description,
      totalCents: input.totalCents,
      startDate: input.startDate,
      dueRule: input.dueRule ?? BillingDueRule.Fixed,
      ...split,
      ...editable,
    };
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
      // Never send a bell for a participant the agenda no longer shows as reachable: the bell does
      // not render for them, so a stale value seeded from editing must not travel either.
      const notify =
        draft.notify &&
        Object.fromEntries(
          Object.entries(draft.notify).filter(([userId]) =>
            notifiableIds.has(userId),
          ),
        );
      // The kill switch off never lets a whatsapp channel out, whatever the picker showed before it flipped.
      const reminders =
        whatsappEnabled() || !draft.reminders
          ? draft.reminders
          : draft.reminders.map((rule) => ({
              ...rule,
              channels: { email: true, whatsapp: false },
            }));
      // Only a creation checks that a recorrente registro starts today or later.
      const next: Attempt = {
        input: buildBillingInput(
          { ...draft, notify, reminders },
          billing ? undefined : new Date(),
        ),
        key: crypto.randomUUID(),
        uncertain: false,
      };

      // Only a recorrente edit that changes what its charges carry, with charges of this month still ahead, needs the answer.
      if (
        billing &&
        shouldAskEditScope(
          billing,
          patchBody(next.input),
          todayIn(billing.timezone),
        )
      ) {
        setScopeAttempt(next);

        return;
      }

      void save(next);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  const today = todayIn(draft.timezone);
  const totalCents = draftTotalCents(draft);
  const { amounts, error: hint } = previewBillingSplit(draft);

  /** The draft seats people by account; the rows look their agenda entry up by that id. */
  function contactFor(userId: string): Contact {
    return (
      recent.find((contact) => contact.userId === userId) ??
      directory.find((contact) => contact.userId === userId) ??
      unknownContact(userId)
    );
  }

  /** The counterpart seat holds the agenda entry itself, the way the API files keys and contas a pagar. */
  function contactById(id: string): Contact {
    const found =
      recent.find((contact) => contact.id === id) ??
      directory.find((contact) => contact.id === id);

    if (found) {
      return found;
    }

    // An archived contact leaves the agenda but stays seated on the billing: the loaded detail still names them.
    const seat = billing?.contact;

    if (seat?.id === id) {
      return {
        ...unknownContact(seat.userId),
        id: seat.id,
        name: seat.name,
        displayName: seat.name,
        avatar: seat.avatar,
      };
    }

    return unknownContact(id);
  }

  const chosen = draft.selected.map((userId) => contactFor(userId));
  // Nothing reaches a contact without an e-mail or a phone, so the bell never shows for them.
  const notifiable = chosen.filter(canNotifyContact);
  const notifiableIds = new Set(notifiable.map((contact) => contact.userId));
  // WhatsApp reminders are not wired up on this form yet: it always reads as unavailable, so the
  // chip shows "Em breve" on a plan that could use it, "Plano Básico" on one that could not.
  const whatsappGate = {
    available: false,
    planAllows: plan === PlanTier.Basic,
  };

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

  const modeValues =
    draft.mode === "equal" ? NO_VALUES : draft.values[draft.mode];
  const remainder =
    draft.mode === "fixed" && draft.owner ? ownerRemainderCents() : null;
  // The keys the split actually prices: every participant, plus the owner while they take part (never typed on a fixed split).
  const splitKeys = (
    draft.mode === "fixed"
      ? draft.selected.map((userId) => ({ kind: SplitPartKind.User, userId }))
      : splitParties(draft)
  ).map(splitPartyKey);

  function subtitleOf(contact: Contact, notify: boolean): string {
    if (!canNotifyContact(contact)) {
      return "sem como avisar";
    }

    return notify
      ? contact.email || contact.phone || ""
      : "sem aviso automático";
  }

  const people: SplitPerson[] = [
    ...chosen.map((contact) => {
      const notify = draft.notify?.[contact.userId] !== false;

      return {
        key: contact.userId,
        name: contact.displayName,
        subtitle: subtitleOf(contact, notify),
        avatar: contact.avatar,
        owner: false,
        amountCents: amounts[contact.userId],
        value: modeValues[contact.userId] ?? "",
        notifiable: canNotifyContact(contact),
        notify,
      };
    }),
    {
      key: "owner",
      name: "Eu",
      subtitle: draft.owner ? "sua parte fica com você" : "fora da divisão",
      owner: true,
      amountCents: remainder ?? amounts.owner,
      value: modeValues.owner ?? "",
      notifiable: false,
      notify: false,
      readonlyText:
        draft.mode === "fixed" && draft.owner && remainder !== null
          ? `Você fica com ${money(remainder)}`
          : undefined,
    },
  ];

  /** Everyone with a priced share, named for the review copy. */
  const lines: SplitLine[] = people.flatMap((person) => {
    if (person.owner && !draft.owner) {
      return [];
    }

    const amountCents = person.owner
      ? (remainder ?? amounts.owner)
      : amounts[person.key];

    return amountCents === undefined
      ? []
      : [{ name: person.name, amountCents, owner: person.owner }];
  });

  // A seat whose keys have not landed yet answers none, so the selector never offers another contact's.
  const payeeLoaded = payeeKeys.contactId === draft.payee;
  // The same selector serves both directions, over whichever keys pay this conta.
  const methods = payable ? (payeeLoaded ? payeeKeys.methods : []) : wallet;
  const selectedPix = methods.find((method) => method.id === draft.pix) ?? null;
  const seatId = payable ? draft.payee : (draft.selected[0] ?? "");
  const seated = seatId
    ? payable
      ? contactById(seatId)
      : contactFor(seatId)
    : null;
  const pixTitle = payable ? "Pagar via Pix" : "Receber por";
  const pixText = selectedPix ? paymentMethodText(selectedPix) : null;
  const pixValue = pixText
    ? `${pixText.title} · ${abbreviate(pixText.value)}`
    : payable && payeeLoaded && !methods.length
      ? "Sem chave no contato"
      : "Nenhum meio escolhido";
  const visibleEffective = effective.map((rule) => ({
    ...rule,
    channels: visibleChannels(rule.channels),
  }));
  const activeReminders: ReminderRule[] = draft.reminders
    ? draft.reminders.map((rule) => ({
        ...rule,
        offsetDays: Number(rule.offsetDays) || 0,
      }))
    : effective;
  const remindersValue = reminderRowLabel(
    draft.reminders === null,
    activeReminders,
    reminderSummary(visibleEffective),
  );
  // Who gets an automatic notice: reachable participants whose bell is on.
  const noticed = notifiable.filter(
    (contact) => draft.notify?.[contact.userId] !== false,
  );
  const group = !payable && !settled ? (draft.whatsappGroup ?? null) : null;
  const noticeDate =
    !payable && !settled && (group || noticed.length)
      ? firstNoticeDate(draft.start, activeReminders)
      : null;
  const counterpart = seated?.displayName ?? billing?.counterpart?.name ?? null;
  const summary = receiptSentence(draft, lines, counterpart);
  const action = editing ? "Salvar conta" : "Criar conta";
  // Below `md` a creation still walking its steps shows Continuar in place of the submit.
  const stepping = !editing && step < 3;
  // The amount others owe per occurrence: everyone but the owner.
  const othersCents = lines
    .filter((line) => !line.owner)
    .reduce((sum, line) => sum + line.amountCents, 0);
  const ownCents = lines.find((line) => line.owner)?.amountCents ?? 0;
  const perOccurrence =
    draft.type === BillingRecurrence.Indefinite
      ? draft.frequency === BillingFrequency.Yearly
        ? "A receber por ano"
        : "A receber por mês"
      : draft.type === BillingRecurrence.Until
        ? "A receber por parcela"
        : "A receber";

  /** What still blocks leaving the current step, phrased like the app's steps. */
  function stepError(): string | null {
    if (step === 1) {
      if (typedCents(draft) <= 0) {
        return "Informe o valor.";
      }

      if (!draft.description.trim()) {
        return "Dê um título à conta.";
      }

      if (!draft.start) {
        return "Informe a data.";
      }

      if (
        draft.type === BillingRecurrence.Until &&
        !untilInstallmentPreview(draft)
      ) {
        return "Informe quantas vezes cobrar, como 3 ou 12.";
      }

      return null;
    }

    if (payable) {
      return draft.payee ? null : SEAT_HINTS.payable;
    }

    if (!draft.selected.length) {
      return settled ? SEAT_HINTS.receivable : "Selecione ao menos um contato.";
    }

    return !seating && hint ? hint : null;
  }

  function advance() {
    const blocker = stepError();

    if (blocker) {
      setError(blocker);

      return;
    }

    setError("");
    setStep((current) => (current === 1 ? 2 : 3));
  }

  function stepBack() {
    setError("");
    setStep((current) => (current === 3 ? 2 : 1));
  }

  function scopeExplanation(detail: BillingDetail): string {
    const day = todayIn(detail.timezone);

    return editScopeExplanation(editableMonthCharges(detail, day).length, day);
  }

  function renderSplit() {
    if (seating) {
      return (
        <SeatPanel
          label={SEAT_LABELS[draft.direction]}
          hint={SEAT_HINTS[draft.direction]}
          seated={seated}
          locked={seatLocked}
          disabled={locked || frozen}
          pickRef={pickPayee}
          onPick={() => setPicker(true)}
          onClear={clearSeat}
        />
      );
    }

    return (
      <SplitPanel
        draft={draft}
        people={people}
        hint={hint ?? ""}
        footer={splitFooterLine(draft, splitKeys, amounts)}
        disabled={locked || frozen}
        addRef={addContact}
        onMode={(mode) => update({ mode })}
        onValue={changeSplitValue}
        onNotify={switchNotify}
        onRemove={toggle}
        onOwner={(owner) => update({ owner })}
        onAdd={() => setPicker(true)}
        groupRef={groupRow}
        group={
          groupsReady || group
            ? {
                current: group,
                onPick: () => setPanel("group"),
                onClear: () => update({ whatsappGroup: null }),
              }
            : undefined
        }
      />
    );
  }

  function renderReminders() {
    if (draft.reminders === null) {
      return (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface px-3 py-2.5">
          <span className="text-sm text-ink">
            Usando seu padrão: {reminderSummary(visibleEffective)}
          </span>
          <button
            type="button"
            className="text-sm font-semibold text-primary"
            disabled={locked}
            onClick={() =>
              update({
                reminders: effective.map((rule) => ({
                  ...rule,
                  offsetDays: String(rule.offsetDays),
                })),
              })
            }
          >
            Personalizar
          </button>
        </div>
      );
    }

    return (
      <>
        <ReminderEditor
          rules={draft.reminders}
          onChange={(reminders) => update({ reminders })}
          whatsapp={whatsappGate}
          disabled={locked}
        />
        <ReminderPreview
          rules={draft.reminders}
          dueDate={draft.start || today}
        />
        <button
          type="button"
          className="self-start text-sm font-semibold text-muted"
          disabled={locked}
          onClick={() => update({ reminders: null })}
        >
          Voltar ao padrão
        </button>
      </>
    );
  }

  function renderPix() {
    if (payable && payeeLoaded && !methods.length) {
      return (
        <div
          className="flex flex-col items-start gap-2 rounded-xl border border-outline/40 bg-surface p-3"
          role="status"
        >
          <p className="m-0 text-xs leading-5 text-muted">{NO_CONTACT_KEY}</p>
          <button
            type="button"
            onClick={leaveToContactKeys}
            className="min-h-9 bg-transparent px-0 text-xs font-bold text-primary"
          >
            Cadastrar chave
          </button>
        </div>
      );
    }

    return (
      <>
        {!methods.length && (
          <p className="m-0 text-xs leading-5 text-muted">
            Nenhum meio cadastrado.
          </p>
        )}
        <ul
          role="listbox"
          aria-label="Meio de pagamento"
          className="m-0 flex list-none flex-col gap-2 p-0"
        >
          {methods.map((method) => {
            const active = draft.pix === method.id;
            const text = paymentMethodText(method);

            return (
              <li key={method.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    update({ pix: method.id });
                    setPanel(null);
                  }}
                  className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left ${active ? "border-primary bg-primary-soft/40" : "border-outline/40 bg-surface"}`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-strong">
                    <ProviderIcon method={method} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {text.title}
                      </span>
                      {method.isDefault && (
                        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-muted">
                          Padrão
                        </span>
                      )}
                    </span>
                    <span className="truncate text-[11px] text-muted">
                      {text.value}
                    </span>
                  </span>
                  {active && (
                    <Check
                      size={18}
                      aria-hidden="true"
                      className="text-primary-strong"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {!payable && !editing && !gate && (
          <button
            type="button"
            aria-label="Cadastrar chave"
            onClick={() => leaveTo(PIX_SETUP)}
            className="min-h-10 self-start bg-transparent text-[13px] font-semibold text-primary"
          >
            + Cadastrar meio de pagamento
          </button>
        )}
      </>
    );
  }

  /** The two rows every conta shares: the reminders and the key. */
  function renderDefaultRows(actionKind: "alter" | "open") {
    if (settled) {
      return null;
    }

    return (
      <>
        <DetailRow
          icon={Bell}
          tone="muted"
          label="Lembretes"
          value={remindersValue}
          action={actionKind}
          buttonRef={remindersRow}
          onClick={() => setPanel("reminders")}
          disabled={locked}
        />
        {(!payable || Boolean(draft.payee)) && (
          <DetailRow
            icon={KeyRound}
            tone="success"
            label={pixTitle}
            value={pixValue}
            action={actionKind}
            buttonRef={pixRow}
            onClick={
              payable && payeeLoaded && !methods.length
                ? leaveToContactKeys
                : () => setPanel("pix")
            }
            disabled={locked}
          />
        )}
      </>
    );
  }

  function renderSummary() {
    if (!summary) {
      return null;
    }

    return (
      <div
        className="flex flex-col gap-3 rounded-2xl bg-primary-soft/60 px-4 py-3.5"
        role="status"
      >
        {!editing && <span className={LABEL_CLASS}>Resumo</span>}
        <p className="m-0 text-[13.5px] leading-5 text-primary-strong">
          {summary}
        </p>
        {!editing && group && noticeDate && (
          <p className="m-0 text-[12.5px] leading-5 text-primary-strong">
            {groupFirstNoticeSentence(group.name, noticeDate)}
          </p>
        )}
        {!editing && !payable && !settled && (
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-primary/15 pt-3 text-[12.5px] text-primary-strong">
            <dt className="m-0">{perOccurrence}</dt>
            <dd className="m-0 font-bold tabular-nums">{money(othersCents)}</dd>
            {draft.owner && ownCents > 0 && (
              <>
                <dt className="m-0">Sua parte</dt>
                <dd className="m-0 font-bold tabular-nums">
                  {money(ownCents)}
                </dd>
              </>
            )}
            {noticeDate && (
              <>
                <dt className="m-0">Primeiro aviso</dt>
                <dd className="m-0 font-bold">{dayMonth(noticeDate)}</dd>
              </>
            )}
          </dl>
        )}
      </div>
    );
  }

  /** The app's step header, only below `md`: back, title, "N de 3" and the progress bar. */
  function renderStepHeader() {
    const title =
      step === 2 && seating ? SEAT_LABELS[draft.direction] : STEP_TITLES[step];

    return (
      <div className="flex flex-col gap-3 md:hidden">
        <div className="flex items-center gap-3">
          {step > 1 && (
            <button
              type="button"
              aria-label="Voltar"
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-outline bg-surface text-ink"
              onClick={stepBack}
            >
              <ChevronLeft aria-hidden="true" size={18} />
            </button>
          )}
          <h2 className="m-0 flex-1 text-[19px] font-bold text-ink">{title}</h2>
          <span className="text-[13px] font-semibold text-muted">
            {step} de 3
          </span>
        </div>
        <div
          className="flex gap-1.5"
          aria-label={`Passo ${step} de 3`}
          role="img"
        >
          {[1, 2, 3].map((index) => (
            <span
              key={index}
              className={`h-1 flex-1 rounded-full ${index <= step ? "bg-primary" : "bg-outline"}`}
            />
          ))}
        </div>
      </div>
    );
  }

  /** The review step of the app (6e), only below `md`: what the conta is and what each step filled, with a way back. */
  function renderReview() {
    const splitValue = seating
      ? seated
        ? seated.displayName
        : SEAT_HINTS[draft.direction]
      : lines.length
        ? splitSummaryLine(lines)
        : splitCountLabel(draft, splitKeys);

    return (
      <div className="flex flex-col gap-3 md:hidden">
        <div className="flex items-center gap-3 rounded-[20px] border border-outline bg-surface p-4">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${billingCategoryColor(draft.category)}1F` }}
          >
            <CategoryIcon category={draft.category} size={20} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-bold text-ink">
              {draft.description || billingCategoryLabel(draft.category)}
            </span>
            <span className="text-[12.5px] text-muted">
              {directionLine(draft)}
            </span>
          </span>
          <span className="font-display text-[19px] font-bold text-ink tabular-nums">
            {money(typedCents(draft))}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <span className={LABEL_CLASS}>Do que você preencheu</span>
          <DetailCard>
            <DetailRow
              icon={CalendarDays}
              label="Repetição · passo 1"
              value={repetitionLabel(draft)}
              action="edit"
              disabled={locked}
              onClick={() => setStep(1)}
            />
            <DetailRow
              icon={Users}
              label={`${seating ? SEAT_LABELS[draft.direction] : "Divisão"} · passo 2`}
              value={splitValue}
              action="edit"
              disabled={locked}
              onClick={() => setStep(2)}
            />
          </DetailCard>
        </div>
      </div>
    );
  }

  function renderCreate() {
    return (
      <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)] md:items-start">
        {renderStepHeader()}
        <section
          className={`${stepClass(step, 1)} min-w-0 flex-col gap-3`}
          aria-label="O quê e quando"
        >
          <ColumnTitle number={1}>O quê e quando</ColumnTitle>
          <Card>
            <Segmented
              name="Direção"
              group="billing-direction"
              options={DIRECTIONS}
              value={draft.direction}
              disabled={locked}
              onChange={pickDirection}
            />
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface px-3 py-2">
              <span className="text-xs font-semibold text-ink">
                {SETTLED_LABELS[draft.direction]}
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label={SETTLED_LABELS[draft.direction]}
                className="h-5 w-5 accent-primary"
                disabled={locked}
                checked={settled}
                onChange={(event) => update({ settled: event.target.checked })}
              />
            </label>
            {settled && (
              <p className="m-0 -mt-2 text-[11px] text-muted">{SETTLED_HELP}</p>
            )}
            <AmountTitleFields
              draft={draft}
              locked={locked}
              frozen={false}
              onChange={update}
            />
            <RepeatFields
              draft={draft}
              locked={locked}
              scheduled={false}
              dueLocked={false}
              onChange={update}
            />
          </Card>
        </section>

        <section
          className={`${stepClass(step, 2)} min-w-0 flex-col gap-3`}
          aria-label={seating ? SEAT_LABELS[draft.direction] : "Divisão"}
        >
          <ColumnTitle
            number={2}
            trailing={
              !seating && totalCents > 0 ? (
                <span className="text-[13px] font-bold text-success">
                  fecha {money(totalCents)}
                </span>
              ) : undefined
            }
          >
            {seating ? SEAT_LABELS[draft.direction] : "Divisão"}
          </ColumnTitle>
          <Card>{renderSplit()}</Card>
        </section>

        <section
          className={`${stepClass(step, 3)} min-w-0 flex-col gap-3`}
          aria-label="Avisos e recebimento"
        >
          <ColumnTitle number={3}>
            {settled ? "Resumo" : "Avisos e recebimento"}
          </ColumnTitle>
          {renderReview()}
          {!settled && (
            <div className="flex flex-col gap-2">
              <span className={`${LABEL_CLASS} md:hidden`}>
                Já configurado pelo padrão
              </span>
              <DetailCard>{renderDefaultRows("alter")}</DetailCard>
            </div>
          )}
          {noticeDate && (
            <p className="m-0 rounded-2xl bg-primary-soft/60 px-4 py-3 text-[13px] leading-5 text-primary-strong md:hidden">
              {group
                ? groupFirstNoticeSentence(group.name, noticeDate)
                : firstNoticeSentence(
                    noticed.map((contact) => contact.displayName),
                    noticeDate,
                    Boolean(selectedPix),
                  )}
            </p>
          )}
          <div className="hidden md:contents">{renderSummary()}</div>
        </section>
      </div>
    );
  }

  function renderEdit() {
    const splitValue = seating
      ? seated
        ? seated.displayName
        : SEAT_HINTS[draft.direction]
      : splitCountLabel(draft, splitKeys);

    return (
      <div className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-4">
        {frozen && (
          <p className="m-0 mt-4 rounded-2xl bg-primary-soft/50 p-4 text-sm text-primary-strong">
            {FROZEN_NOTE}
          </p>
        )}
        {billing?.whatsappGroupFailing && group && (
          <p
            role="alert"
            className="m-0 mt-4 rounded-2xl bg-warning-soft p-4 text-sm text-warning"
          >
            Não foi possível avisar no grupo {group.name}. Os avisos foram para
            cada pessoa. Confira se seu número ainda está no grupo, ou troque o
            grupo.
          </p>
        )}
        {/* A registro stays one: the switch shows locked, so the screen still says what this conta is. */}
        {settled && (
          <label className="flex items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface p-3">
            <span className="flex min-w-0 flex-col">
              <span className="text-xs font-semibold text-ink">
                {SETTLED_LABELS[draft.direction]}
              </span>
              <span className="text-[11px] text-muted">{SETTLED_LOCKED}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label={SETTLED_LABELS[draft.direction]}
              className="h-5 w-5 accent-primary"
              disabled
              checked
              readOnly
            />
          </label>
        )}
        <Card>
          <AmountTitleFields
            draft={draft}
            locked={locked}
            frozen={frozen}
            onChange={update}
          />
        </Card>

        <div className="flex flex-col gap-2">
          <span className={LABEL_CLASS}>Detalhes</span>
          <DetailCard>
            <DetailRow
              icon={CalendarDays}
              label="Repetição"
              value={repetitionLabel(draft)}
              buttonRef={repeatRow}
              onClick={() => setPanel("repeat")}
              disabled={locked}
            />
            <DetailRow
              icon={Users}
              label={seating ? SEAT_LABELS[draft.direction] : "Divisão"}
              value={splitValue}
              trailing={
                !seating && chosen.length ? (
                  <span className="flex items-center">
                    {chosen.slice(0, 3).map((contact, index) => (
                      <span
                        key={contact.userId}
                        className={index ? "-ml-2" : ""}
                      >
                        <InitialsAvatar
                          name={contact.displayName}
                          size={22}
                          avatar={contact.avatar}
                        />
                      </span>
                    ))}
                    {draft.owner && (
                      <span className="-ml-2">
                        <InitialsAvatar name="Eu" size={22} inverted />
                      </span>
                    )}
                  </span>
                ) : undefined
              }
              buttonRef={splitRow}
              onClick={seatLocked ? undefined : () => setPanel("split")}
              disabled={locked || frozen}
            />
            {renderDefaultRows("open")}
          </DetailCard>
        </div>

        {renderSummary()}
      </div>
    );
  }

  return (
    <form className="flex w-full min-w-0 flex-col gap-4 pb-6" onSubmit={submit}>
      {/* Without a key there is nothing to send: the form waits behind a single call to action. */}
      {gate ? (
        <section
          className="mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-3xl border border-outline/40 bg-surface px-6 py-10 text-center"
          role="status"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft/60 text-primary-strong">
            <KeyRound size={26} aria-hidden="true" />
          </span>
          <h2 className="m-0 text-xl font-bold text-primary-strong">
            {PIX_GATE_TITLE}
          </h2>
          <p className="m-0 max-w-sm text-sm leading-5 text-muted">
            {PIX_GATE_NOTE}
          </p>
          <button
            type="button"
            className="mt-2 h-12 w-full max-w-sm rounded-xl bg-primary font-bold text-on-primary"
            onClick={() => leaveTo(PIX_SETUP)}
          >
            Cadastrar meio de pagamento
          </button>
          <div className="w-full max-w-sm pt-2">
            <Segmented
              name="Direção"
              group="billing-direction"
              options={DIRECTIONS}
              value={draft.direction}
              disabled={locked}
              onChange={pickDirection}
            />
            <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface px-3 py-2">
              <span className="text-xs font-semibold text-ink">
                {SETTLED_LABELS[draft.direction]}
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label={SETTLED_LABELS[draft.direction]}
                className="h-5 w-5 accent-primary"
                disabled={locked}
                checked={settled}
                onChange={(event) => update({ settled: event.target.checked })}
              />
            </label>
          </div>
        </section>
      ) : (
        <>
          {!ready && !error && (
            <p className="m-0 text-muted" role="status">
              Carregando dados…
            </p>
          )}

          {editing ? renderEdit() : renderCreate()}

          {error && (
            <p
              className="m-0 rounded-xl bg-danger-soft p-4 text-danger"
              role="alert"
            >
              {error}
            </p>
          )}

          <ScreenFooter className="-mx-1 border-t border-outline/30 bg-canvas/95 px-1 pb-2 pt-4 backdrop-blur-md">
            {busy && (
              <p className="m-0 mb-2 text-sm text-muted" role="status">
                Salvando…
              </p>
            )}
            <div className="mx-auto w-full max-w-md">
              {attempt?.uncertain ? (
                <button
                  type="submit"
                  className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-outline bg-transparent text-sm font-bold text-primary"
                  disabled={busy}
                >
                  {busy && (
                    <Loader2
                      aria-hidden="true"
                      size={18}
                      className="animate-spin"
                    />
                  )}
                  Tentar novamente
                </button>
              ) : (
                <>
                  {stepping && (
                    <button
                      type="button"
                      className="flex h-[54px] w-full items-center justify-center rounded-2xl bg-primary text-[15px] font-bold text-on-primary md:hidden"
                      onClick={advance}
                    >
                      {CONTINUE_LABELS[step]}
                    </button>
                  )}
                  <button
                    type="submit"
                    className={`${stepping ? "hidden md:flex" : "flex"} h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[15px] font-bold text-on-primary disabled:opacity-50`}
                    disabled={busy || (!editing && !totalCents)}
                  >
                    {busy && (
                      <Loader2
                        aria-hidden="true"
                        size={18}
                        className="animate-spin"
                      />
                    )}
                    {!editing && noticeDate ? "Criar conta e avisar" : action}
                  </button>
                </>
              )}
            </div>
          </ScreenFooter>
        </>
      )}

      {picker && (
        <ContactPickerSheet
          selected={seating ? (seatId ? [seatId] : []) : draft.selected}
          by={payable ? "id" : "userId"}
          returnFocusTo={seating ? pickPayee : addContact}
          onToggle={seating ? seat : (contact) => toggle(contact.userId)}
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

      {panel === "repeat" && (
        <BillingDialog
          title="Repetição"
          returnFocusTo={repeatRow}
          onClose={() => setPanel(null)}
        >
          {frozen && (
            <p className="m-0 rounded-2xl bg-primary-soft/50 p-4 text-sm text-primary-strong">
              {FROZEN_NOTE}
            </p>
          )}
          <RepeatFields
            draft={draft}
            locked={locked}
            scheduled={scheduled}
            dueLocked={dueLocked}
            onChange={update}
          />
        </BillingDialog>
      )}

      {panel === "split" && (
        <BillingDialog
          title={seating ? SEAT_LABELS[draft.direction] : "Divisão"}
          trailing={
            !seating && totalCents > 0 ? (
              <span className="text-[13px] font-bold text-success">
                fecha {money(totalCents)}
              </span>
            ) : undefined
          }
          returnFocusTo={splitRow}
          onClose={() => setPanel(null)}
        >
          {renderSplit()}
        </BillingDialog>
      )}

      {panel === "reminders" && (
        <BillingDialog
          title="Lembretes"
          returnFocusTo={remindersRow}
          onClose={() => setPanel(null)}
        >
          {renderReminders()}
        </BillingDialog>
      )}

      {panel === "group" && (
        <WhatsappGroupDialog
          participants={draft.selected}
          selected={group?.jid ?? null}
          load={loadGroups}
          returnFocusTo={groupRow}
          onPick={(picked) => {
            update({ whatsappGroup: { jid: picked.jid, name: picked.name } });
            // The edit picks it from the Divisão dialog: back there, not all the way out.
            setPanel(editing ? "split" : null);
          }}
          onClose={() => setPanel(editing ? "split" : null)}
        />
      )}

      {panel === "pix" && (
        <BillingDialog
          title={pixTitle}
          doneLabel=""
          returnFocusTo={pixRow}
          onClose={() => setPanel(null)}
        >
          {renderPix()}
        </BillingDialog>
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

      {paywall && (
        <PlanPaywall error={paywall} onClose={() => setPaywall(null)} />
      )}
    </form>
  );
}
