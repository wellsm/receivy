import {
  addCalendarDays,
  amountDigitsToInput,
  amountInputToDigits,
  billingCategoryLabel,
  billingDraftSummary,
  billingDraftSummaryText,
  BillingDueRule,
  BillingFrequency,
  buildBillingInput,
  calendarDate,
  draftTotalCents,
  editableMonthCharges,
  editScopeExplanation,
  EditScope,
  EMPTY_BILLING_DRAFT,
  EMPTY_SPLIT_VALUES,
  endOfMonth,
  formatAmountDigits,
  formatMoney,
  parseBRLCents,
  previewBillingSplit,
  shouldAskEditScope,
  splitParties,
  splitPartyKey,
  canNotifyContact,
  untilInstallmentPreview,
  UserStatus,
  type BillingDetail,
  type BillingDraft,
  type BillingInput,
  BillingKind,
  type BillingPatch,
  BillingRecurrence,
  type Contact,
  Direction,
  paymentMethodText,
  PaymentProvider,
  type PaymentMethod,
  type PixKeyType,
  SplitMode,
  SplitPartKind,
  type SplitParty,
  type SplitValues,
} from "@receivy/common";
import * as Crypto from "expo-crypto";
import { useFocusEffect, useNavigation } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Image } from "expo-image";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, useColorScheme, View } from "react-native";
import { MonthSelect } from "@/components/app/month-select";
import { ScopeModal } from "@/components/app/scope-modal";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { financialClient, FinancialRequestError, type FinancialClient } from "@/financial/client";
import { clearDraft, saveDraft, takeDraft } from "@/financial/draft-store";
import { PLAN_SITE_SUFFIX } from "@/financial/plan-copy";
import { contactsClient } from "@/contacts/client";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { CategorySelect } from "@/components/app/category-select";
import { ContactPickerSheet } from "@/components/app/contact-picker-sheet";
import { SplitEditor, type SplitRow } from "@/components/app/split-editor";
import { useThemeColors } from "@/theme/colors";

const closeMark = require("../../../assets/images/auth/plus.svg");
const keyMark = require("../../../assets/images/auth/key.svg");
const chevronMark = require("../../../assets/images/auth/chevron.svg");
const calendarMark = require("../../../assets/images/auth/calendar.svg");
const checkMark = require("../../../assets/images/auth/check.svg");
const infinityMark = require("../../../assets/images/auth/infinity.svg");
const bankMark = require("../../../assets/images/auth/bank.svg");

const PIX_ICONS: Record<PixKeyType, number> = {
  cpf: require("../../../assets/images/auth/id-card.svg"),
  cnpj: require("../../../assets/images/auth/building.svg"),
  phone: require("../../../assets/images/auth/phone.svg"),
  email: require("../../../assets/images/auth/mail.svg"),
  random: keyMark,
};

function iconOf(method: PaymentMethod): number {
  if (method.provider === PaymentProvider.PagSeguro) {
    return bankMark;
  }

  if (method.provider === PaymentProvider.InfinitePay || !method.kind) {
    return infinityMark;
  }

  return PIX_ICONS[method.kind];
}

type Client = Pick<FinancialClient, "paymentMethods" | "profile" | "createBilling" | "patchBilling">;
type Attempt = { input: BillingInput; key: string; uncertain: boolean; applyTo?: EditScope };

type BillingFormScreenProps = {
  client?: Client;
  contacts?: Pick<typeof contactsClient, "list">;
  billing?: BillingDetail | null;
  onSaved: (billing: BillingDetail) => void;
  /**
   * Only the embedded edit inside `BillingsScreen` needs its own way out; the
   * routed form is popped by the native header instead.
   */
  onBack?: () => void;
  /** Absent when the screen cannot navigate to the contact form. */
  onCreateContact?: () => void;
  /** Absent when the screen cannot navigate to the contact being paid: the key of a conta a pagar lives there. */
  onEditContact?: (contactId: string) => void;
  /** Absent when the screen cannot navigate to the Pix keys. */
  onCreatePix?: (required?: boolean) => void;
};

const FROZEN_NOTE = "Contas já geradas só permitem categoria, Pix e lembretes.";
const LOAD_ERROR = "Não foi possível carregar os dados.";
const PIX_GATE_TITLE = "Cadastre um meio de pagamento";
const PIX_GATE_NOTE = "Uma conta a receber gera um link de pagamento com o seu Pix, sua InfinitePay ou seu PagBank. Cadastre um e volte para continuar de onde parou.";
const NO_CONTACT_KEY = "Este contato ainda não tem chave Pix. Cadastre no contato.";
const NO_VALUES: Record<string, string> = {};

const TYPES: { value: BillingRecurrence; label: string }[] = [
  { value: BillingRecurrence.Once, label: "À vista" },
  { value: BillingRecurrence.Until, label: "Parcelado" },
  { value: BillingRecurrence.Indefinite, label: "Recorrente" },
];

const AMOUNT_LABELS: Record<BillingRecurrence, string> = {
  once: "Valor total",
  until: "Valor total",
  indefinite: "Valor por ocorrência",
};

/** A conta a pagar has no split, so "total" says nothing there. */
const PAYABLE_AMOUNT_LABELS: Record<BillingRecurrence, string> = { ...AMOUNT_LABELS, once: "Valor" };

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: Direction.Receivable, label: "Vou receber" },
  { value: Direction.Payable, label: "Vou pagar" },
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

/** The segmented control shows the short label; the accessible name keeps the full one. */
const SPLIT_MODES: { value: SplitMode; label: string; name: string }[] = [
  { value: SplitMode.Equal, label: "Igual", name: "Igual" },
  { value: SplitMode.Shares, label: "Cotas", name: "Cotas" },
  { value: SplitMode.Percentage, label: "%", name: "Porcentagem" },
  { value: SplitMode.Fixed, label: "Fixo", name: "Valor fixo" },
];

const QUICK_DUE: { label: string; days: number }[] = [{ label: "Hoje", days: 0 }];

function money(amountCents: number): string {
  return formatMoney({ amountCents, currency: "BRL" });
}

function moneyText(amountCents: number): string {
  return money(amountCents).replace(/[^\d,]/g, "");
}

/** The due date is typed by hand, so a real calendar day is checked before the shared builder sees it. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const time = Date.parse(`${value}T00:00:00.000Z`);

  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** The picker works with the device's local calendar; the draft keeps `AAAA-MM-DD`. */
function dateFromCalendar(value: string, fallback: string): Date {
  const [year, month, day] = (isCalendarDate(value) ? value : fallback).split("-").map(Number);

  return new Date(year!, month! - 1, day!);
}

function calendarFromDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
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
    selected: parts.flatMap((part) => (part.kind === "user" ? [part.userId] : [])),
    owner: parts.some((part) => part.kind === "owner") || billing.split.mode === "fixed",
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
    reminders: billing.reminders.map((reminder) => ({ ...reminder, offsetDays: String(reminder.offsetDays) })),
    notify: notifyFromBilling(billing),
    settled: billing.kind === BillingKind.Record,
  };
}

/** A seated user the agenda has not shown yet (a stale draft, a contact removed meanwhile): the chip still needs a face. */
function unknownContact(userId: string): Contact {
  return {
    id: userId,
    userId,
    name: "Contato",
    nickname: null,
    displayName: "Contato",
    email: "",
    phone: null,
    status: UserStatus.Pending,
    archivedAt: null,
    createdAt: "",
    lastBilledAt: null,
    activeCharges: 0,
  };
}

function abbreviate(pixKey: string): string {
  return pixKey.length <= 18 ? pixKey : `${pixKey.slice(0, 7)}…${pixKey.slice(-7)}`;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <Text className="ml-0.5 font-sans text-[11px] font-semibold uppercase tracking-[0.88px] text-muted">{children}</Text>;
}

function Card({ children }: { children: ReactNode }) {
  return <View className="gap-3 rounded-[20px] border border-outline bg-surface p-4">{children}</View>;
}

function Chip({ label, active, disabled, icon, onPress }: { label: string; active: boolean; disabled: boolean; icon?: ReactNode; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`h-[38px] flex-row items-center gap-1.5 rounded-xl border px-3.5 ${active ? "border-primary bg-primary-soft" : "border-outline bg-surface"} ${disabled ? "opacity-50" : ""}`}
    >
      {icon}
      <Text className={`font-sans text-[12.5px] ${active ? "font-bold text-primary-strong" : "font-semibold text-muted"}`}>{label}</Text>
    </Pressable>
  );
}

const SEGMENT_STYLES = {
  /** Direction: two wide buttons, the chosen one filled with the brand. */
  primary: {
    box: "h-[38px] flex-1 rounded-xl",
    on: "bg-primary",
    off: "border border-outline bg-surface",
    text: "text-[13px] font-bold",
    textOn: "text-on-primary",
  },
  /** Split mode: compact chips, the chosen one in ink. */
  ink: {
    box: "h-7 rounded-[9px] px-2.5",
    on: "bg-ink",
    off: "bg-surface-muted",
    text: "text-[11.5px] font-semibold",
    textOn: "font-bold text-surface",
  },
} as const;

type SegmentProps = { label: string; name: string; active: boolean; disabled: boolean; variant?: keyof typeof SEGMENT_STYLES; onPress: () => void };

function Segment({ label, name, active, disabled, variant = "primary", onPress }: SegmentProps) {
  const styles = SEGMENT_STYLES[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`items-center justify-center ${styles.box} ${active ? styles.on : styles.off} ${disabled && !active ? "opacity-50" : ""}`}
    >
      <Text className={`font-sans ${styles.text} ${active ? styles.textOn : "text-muted"}`}>{label}</Text>
    </Pressable>
  );
}

function TypeButton({ label, active, disabled, onPress }: { label: string; active: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`h-[38px] flex-1 items-center justify-center rounded-xl border px-2 ${active ? "border-primary bg-primary-soft" : "border-outline bg-surface"} ${disabled ? "opacity-50" : ""}`}
    >
      <Text className={`font-sans text-[12.5px] ${active ? "font-bold text-primary-strong" : "font-semibold text-muted"}`}>{label}</Text>
    </Pressable>
  );
}

export function BillingFormScreen({
  client = financialClient,
  contacts = contactsClient,
  billing = null,
  onSaved,
  onBack,
  onCreateContact,
  onEditContact,
  onCreatePix,
}: BillingFormScreenProps) {
  const navigation = useNavigation();
  const colors = useThemeColors();
  const scheme = useColorScheme();
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
  const [pixOpen, setPixOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [scopeAttempt, setScopeAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [gated, setGated] = useState(false);
  const loaded = useRef(false);

  const editing = Boolean(billing);
  const locked = Boolean(attempt);
  const frozen = editing && billing?.recurrence !== "indefinite";
  const payable = draft.direction === "payable";
  // A registro pays or is paid like any other conta; only reminders, splits and proofs leave the form.
  const settled = draft.settled === true;
  // The counterpart of a registro never moves: the API answers 409 for a contact change on one.
  const seatLocked = editing && settled;
  // A conta a pagar is paid elsewhere and a registro is already settled, so the wallet gate only holds a conta a receber.
  const blocked = gated && !payable && !settled;
  // `BillingPatch` carries no type, frequency or dates, so the schedule is
  // read-only in every edit — otherwise Salvar would silently drop the change.
  const scheduled = editing;
  // An assinatura may move its next due date; generated occurrences keep theirs.
  const dueLocked = scheduled && billing?.recurrence !== "indefinite";

  const load = useCallback(
    (stored: BillingDraft | null) => {
      let live = true;

      void Promise.all([
        contacts.list(false, undefined, undefined, "recent"),
        client.paymentMethods(),
        billing || stored ? Promise.resolve(null) : client.profile(),
      ])
        .then(([agenda, keys, me]) => {
          if (!live) {
            return;
          }

          const active = keys.paymentMethods.filter((method) => !method.archivedAt);

          setRecent(agenda.contacts.slice(0, 12));
          setDirectory(agenda.contacts);
          setWallet(active);
          setGated(!billing && !active.length);
          setDraft((current) => {
            const base = stored ?? current;
            const pix = billing || stored ? base.pix : (active.find((method) => method.isDefault)?.id ?? base.pix);

            return { ...base, pix, ...(me ? { timezone: me.user.timezone, start: todayIn(me.user.timezone) } : {}) };
          });
          setReady(true);
        })
        .catch((reason: unknown) => {
          if (!live) {
            return;
          }

          setDraft((current) => stored ?? current);
          setError(reason instanceof Error ? reason.message : LOAD_ERROR);
        });

      return () => {
        live = false;
      };
    },
    [billing, client, contacts],
  );

  // The route stays mounted while the form takes a side trip to the contact or
  // Pix screens, so the parked draft is picked up on every focus — not only on
  // mount — and the agenda and wallet are refetched to show what was just created.
  useFocusEffect(
    useCallback(() => {
      const stored = billing ? null : takeDraft();

      if (loaded.current && !stored) {
        return undefined;
      }

      loaded.current = true;

      return load(stored);
    }, [billing, load]),
  );

  // Whoever receives a conta a pagar owns the key, so only their keys are on offer.
  const seatedPayee = payable && !settled ? draft.payee : "";

  // Registering one of those keys happens on the contact screen while this route
  // stays mounted, so every focus asks again — and so does a change of seat.
  useFocusEffect(
    useCallback(() => {
      if (!seatedPayee) {
        return undefined;
      }

      let live = true;

      void client
        .paymentMethods(seatedPayee)
        .then((page) => {
          if (live) {
            setPayeeKeys({ contactId: seatedPayee, methods: page.paymentMethods.filter((method) => !method.archivedAt) });
          }
        })
        .catch(() => {
          if (live) {
            setPayeeKeys({ contactId: seatedPayee, methods: [] });
          }
        });

      return () => {
        live = false;
      };
    }, [client, seatedPayee]),
  );

  // Pushing the contact or Pix screen keeps this route mounted, so the parked
  // draft has to survive it. Only popping the form for good throws it away.
  useEffect(() => {
    return navigation.addListener("beforeRemove", () => {
      clearDraft();
    });
  }, [navigation]);

  function update(patch: Partial<BillingDraft>) {
    if (locked) {
      return;
    }

    setError("");
    setDraft((current) => ({ ...current, ...patch }));
  }

  function toggle(userId: string) {
    update({ selected: draft.selected.includes(userId) ? draft.selected.filter((id) => id !== userId) : [...draft.selected, userId] });
  }

  /** The switch reads "Não notificar", so the value it carries is the opposite of what the draft stores. */
  function switchNotify(userId: string, quiet: boolean) {
    update({ notify: { ...draft.notify, [userId]: !quiet } });
  }

  /** The counterpart seat holds one contact: picking closes the sheet, picking the seated one empties it. */
  function seat(contact: Contact) {
    if (payable) {
      update({ payee: draft.payee === contact.id ? "" : contact.id });
    } else {
      update({ selected: draft.selected[0] === contact.userId ? [] : [contact.userId] });
    }

    setPicker(false);
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
    update({ direction, pix: direction === Direction.Payable ? "" : (wallet.find((method) => method.isDefault)?.id ?? "") });
  }

  const remember = useCallback((seen: Contact[]) => {
    setDirectory((current) => [...current, ...seen.filter((contact) => !current.some((known) => known.id === contact.id))]);
  }, []);

  function leaveTo(go: () => void) {
    saveDraft(draft);
    go();
  }

  /** The key of a conta a pagar lives on the contact: the hint sends the owner there and back. */
  function leaveToContactKeys() {
    if (!onEditContact) {
      return;
    }

    // An edit is not restorable from a parked draft: only a creation leaves one behind.
    if (editing) {
      onEditContact(draft.payee);

      return;
    }

    leaveTo(() => onEditContact(draft.payee));
  }

  // The field behaves like a bank keypad: whatever the keyboard hands back is
  // reduced to its digits and re-rendered, so typing pushes cents to the left
  // and the backspace drops the last digit.
  function typeAmount(value: string) {
    update({ amount: amountDigitsToInput(amountInputToDigits(value)) });
  }

  // Android answers once and closes its dialog; the iOS sheet stays open while the
  // user browses months, so only Concluir or the backdrop closes it.
  function pickDate(_event: unknown, date: Date) {
    update({ start: calendarFromDate(date) });

    if (Platform.OS !== "ios") {
      setCalendarOpen(false);
    }
  }

  function changeSplitValue(key: string, value: string) {
    if (draft.mode === "equal") {
      return;
    }

    update({ values: { ...draft.values, [draft.mode]: { ...draft.values[draft.mode], [key]: value } } });
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

    const body = { description: input.description, totalCents: input.totalCents, startDate: input.startDate, dueRule: input.dueRule ?? BillingDueRule.Fixed, ...editable };

    if (toPayable) {
      return body;
    }

    return { ...body, split: input.split };
  }

  async function save(sent: Attempt) {
    setAttempt(sent);
    setBusy(true);
    setError("");

    try {
      const saved = billing
        ? await client.patchBilling(billing.id, sent.applyTo ? { ...patchBody(sent.input), applyTo: sent.applyTo } : patchBody(sent.input))
        : await client.createBilling(sent.input, sent.key);

      setAttempt(null);
      clearDraft();
      // Left busy on purpose: the caller leaves this screen.
      onSaved(saved);
    } catch (reason) {
      const uncertain = sent.uncertain || !(reason instanceof FinancialRequestError) || reason.status >= 500;

      setAttempt(uncertain ? { ...sent, uncertain: true } : null);
      setError(
        reason instanceof FinancialRequestError && reason.status === 402
          ? `${reason.message}${PLAN_SITE_SUFFIX}`
          : reason instanceof Error
            ? reason.message
            : "Não foi possível salvar a conta.",
      );
      setBusy(false);
    }
  }

  function applyScope(applyTo?: EditScope) {
    if (!scopeAttempt) {
      return;
    }

    const sent = applyTo ? { ...scopeAttempt, applyTo } : scopeAttempt;

    setScopeAttempt(null);
    void save(sent);
  }

  function submit() {
    setError("");

    if (attempt) {
      void save(attempt);

      return;
    }

    if (!isCalendarDate(draft.start)) {
      setError("Informe a data como AAAA-MM-DD.");

      return;
    }

    try {
      // Never send "Não notificar" for a participant the agenda no longer shows as reachable: the
      // switch does not render for them, so a stale value seeded from editing must not travel either.
      const notify = draft.notify && Object.fromEntries(Object.entries(draft.notify).filter(([userId]) => notifiableIds.has(userId)));
      // Only a creation checks that a recorrente registro starts today or later.
      const next: Attempt = {
        input: buildBillingInput({ ...draft, notify, pix: payingKey() }, billing ? undefined : new Date()),
        key: Crypto.randomUUID(),
        uncertain: false,
      };

      // Only a recorrente edit that changes what its charges carry, with charges of this month still ahead, needs the answer.
      if (billing && shouldAskEditScope(billing, patchBody(next.input), todayIn(billing.timezone))) {
        setScopeAttempt(next);

        return;
      }

      void save(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Confira os dados informados.");
    }
  }

  const today = todayIn(draft.timezone);
  // Month ends exist for a single due date and for monthly rules; a yearly billing keeps a fixed day.
  const monthEnds = draft.type === "once" || draft.frequency === "monthly";
  const monthEnd = monthEnds && draft.dueRule === "end_of_month";
  // A recorrente registro starts today or later; a single one may be in the past.
  const minimumDate = settled && draft.type !== "once" ? dateFromCalendar(today, today) : undefined;

  function toggleMonthEnd() {
    if (monthEnd) {
      update({ dueRule: BillingDueRule.Fixed });

      return;
    }

    // Typed text may not be a date yet; the month end then starts from today.
    const base = /^\d{4}-\d{2}-\d{2}$/.test(draft.start) && draft.start >= today ? draft.start : today;

    setCalendarOpen(false);
    update({ dueRule: BillingDueRule.EndOfMonth, start: endOfMonth(base) });
  }

  const totalCents = draftTotalCents(draft);
  const installmentPreview = untilInstallmentPreview(draft);
  const { amounts, error: hint } = previewBillingSplit(draft);

  /** The draft seats user ids; the agenda entries loaded so far give them a name. */
  function contactOf(userId: string): Contact {
    return recent.find((contact) => contact.userId === userId) ?? directory.find((contact) => contact.userId === userId) ?? unknownContact(userId);
  }

  /** The counterpart seat holds the agenda entry itself, the way the API files keys and contas a pagar. */
  function contactById(id: string): Contact {
    const found = recent.find((contact) => contact.id === id) ?? directory.find((contact) => contact.id === id);

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

  const chosen = draft.selected.map(contactOf);
  // Who sits on the other side: the contact a conta a pagar pays, or the single person who paid a registro a receber.
  // One sheet serves both roles, and the form never shows the seat and the split together.
  const seating = payable || settled;
  const seatId = payable ? draft.payee : (draft.selected[0] ?? "");
  const seated = seatId ? (payable ? contactById(seatId) : contactOf(seatId)) : null;
  // Nothing reaches a contact without an e-mail or a phone, so the switch never shows for them.
  const notifiable = chosen.filter(canNotifyContact);
  const notifiableIds = new Set(notifiable.map((contact) => contact.userId));

  function nameOf(key: string): string {
    return key === "owner" ? "Eu" : (directory.find((contact) => contact.userId === key)?.name ?? "Contato");
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
  const rowParties: SplitParty[] = draft.mode === "fixed" ? draft.selected.map((userId) => ({ kind: SplitPartKind.User, userId })) : splitParties(draft);
  const rows: SplitRow[] = rowParties.map((party) => {
    const key = splitPartyKey(party);
    const cents = amounts[key];

    return {
      key,
      name: nameOf(key),
      value: modeValues[key] ?? "",
      // A fixed row is the amount itself, so repeating it beside the field says nothing.
      amountText: draft.mode === "fixed" || cents === undefined ? "" : money(cents),
      avatar: key === "owner" ? null : (directory.find((contact) => contact.userId === key)?.avatar ?? null),
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
  const payeeLoaded = payeeKeys.contactId === seatedPayee;
  // The same selector serves both directions, over whichever keys pay this conta.
  const methods = payable ? (payeeLoaded ? payeeKeys.methods : []) : wallet;

  /**
   * The key that actually pays this conta. A conta a pagar can only use one of the
   * seated contact's, so a key left over from another of them — a seat that moved,
   * a draft restored from a side trip — never travels: their default takes over as
   * soon as their keys land, and until then only a seeded edit keeps what it has.
   */
  function payingKey(): string {
    if (!payable || settled) {
      return draft.pix;
    }

    if (!payeeLoaded) {
      return payeeKeys.contactId ? "" : draft.pix;
    }

    if (payeeKeys.methods.some((method) => method.id === draft.pix)) {
      return draft.pix;
    }

    return payeeKeys.methods.find((method) => method.isDefault)?.id ?? payeeKeys.methods[0]?.id ?? "";
  }

  const payingPix = payingKey();
  const selectedPix = methods.find((method) => method.id === payingPix) ?? null;
  // One registered key has nothing to switch to; the sheet only opens with a real choice.
  const switchable = methods.length > 1 || (methods.length === 1 && !selectedPix);
  const pixTitle = payable ? "Pagar via Pix" : "Receber por";
  const action = editing ? "Salvar conta" : "Criar conta";
  const retry = editing ? "Tentar salvar novamente" : "Tentar criar novamente";
  // Create-only, for parity with web: an edit's registro/recorrente past-dated draft can make the
  // summary's own date rule throw, silently hiding the row instead of describing what Salvar does.
  const footerSummary = editing ? null : billingDraftSummary(draft, new Date());

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={onBack ? ["top"] : []}>
      {onBack && (
        <View className="flex-row items-center gap-3 px-5 pb-2 pt-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            onPress={() => {
              clearDraft();
              onBack();
            }}
            className="min-h-11 justify-center"
          >
            <Text className="font-bold text-primary">← Voltar</Text>
          </Pressable>
          <Text accessibilityRole="header" className="text-lg font-extrabold text-primary-strong">
            {editing ? "Editar conta" : "Nova conta"}
          </Text>
        </View>
      )}

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 pb-36 pt-4" showsVerticalScrollIndicator={false}>
        {/* Direção */}
        <View className="flex-row gap-2">
          {DIRECTIONS.map((option) => (
            <Segment
              key={option.value}
              label={option.label}
              name={option.label}
              active={draft.direction === option.value}
              disabled={locked || editing}
              onPress={() => pickDirection(option.value)}
            />
          ))}
        </View>

        {/* Registro: already received or paid. On edit it only shows on a registro, locked. */}
        {(!editing || settled) && (
          <View className="gap-2">
            <View className="flex-row items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface p-3">
              <View className="flex-1">
                <Text className="text-xs font-semibold text-ink">{SETTLED_LABELS[draft.direction].toggle}</Text>
                {editing && <Text className="text-[11px] text-muted">{SETTLED_LOCKED}</Text>}
              </View>
              <Switch
                accessibilityLabel={SETTLED_LABELS[draft.direction].toggle}
                accessibilityState={{ disabled: locked || editing }}
                disabled={locked || editing}
                value={settled}
                onValueChange={(value) => update({ settled: value })}
                trackColor={{ true: colors.primary }}
              />
            </View>
            {settled && <Text className="text-[11px] text-muted">{SETTLED_HELP}</Text>}
          </View>
        )}

        {frozen && <Text className="rounded-2xl bg-primary-soft/50 p-4 text-sm text-primary-strong">{FROZEN_NOTE}</Text>}
        {/* Without a key there is nothing to send: the form waits behind a single call to action. */}
        {blocked ? (
          <View className="items-center gap-3 rounded-3xl border border-outline/40 bg-surface px-6 py-10">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-primary-soft/60">
              <Image source={keyMark} tintColor={colors.primaryStrong} style={{ width: 26, height: 26 }} />
            </View>
            <Text accessibilityRole="header" className="text-center text-xl font-bold text-primary-strong">
              {PIX_GATE_TITLE}
            </Text>
            <Text className="text-center text-sm leading-5 text-muted">{PIX_GATE_NOTE}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cadastrar meio de pagamento"
              accessibilityState={{ disabled: !onCreatePix }}
              disabled={!onCreatePix}
              onPress={() => onCreatePix && leaveTo(() => onCreatePix(true))}
              className="mt-2 h-12 w-full items-center justify-center rounded-xl bg-primary"
            >
              <Text className="font-bold text-on-primary">Cadastrar meio de pagamento</Text>
            </Pressable>
          </View>
        ) : (
          <>
        {!ready && !error && <ActivityIndicator accessibilityLabel="Carregando dados" color={colors.primaryStrong} />}

        {/* Valor */}
        <Card>
          <SectionLabel>{(payable ? PAYABLE_AMOUNT_LABELS : AMOUNT_LABELS)[draft.type]}</SectionLabel>
          <View className="flex-row items-center gap-1.5">
            <Text className="font-display text-base font-medium text-muted">R$</Text>
            <TextInput
              accessibilityLabel="Valor"
              editable={!locked && !frozen}
              keyboardType="number-pad"
              placeholderTextColor={colors.muted}
              value={formatAmountDigits(amountInputToDigits(draft.amount))}
              onChangeText={typeAmount}
              textAlignVertical="center"
              className="h-10 flex-1 py-0 font-display text-[30px] font-bold tracking-tight text-ink"
            />
          </View>
          {installmentPreview && (
            <Text className="text-[11px] text-muted">
              {installmentPreview.count}x de {money(installmentPreview.perInstallmentCents)}
              {installmentPreview.roundedUp ? ` · total ${money(installmentPreview.totalCents)}` : ""}
            </Text>
          )}
        </Card>

        {/* Título e categoria */}
        <View className="gap-3">
          <View className="gap-1">
            <SectionLabel>Título da conta</SectionLabel>
            <TextInput
              accessibilityLabel="Título"
              editable={!locked && !frozen}
              maxLength={500}
              placeholder="Ex: Aluguel do sítio, Pizzaria..."
              placeholderTextColor={colors.muted}
              value={draft.description}
              onChangeText={(value) => update({ description: value })}
              className="h-11 rounded-[14px] border border-outline bg-surface px-3.5 py-0 font-sans text-[15px] tracking-normal text-ink"
            />
          </View>
          <View className="gap-1.5">
            <SectionLabel>Categoria</SectionLabel>
            <CategorySelect
              value={draft.category}
              disabled={locked}
              onSelect={(category) => update({ category, description: draft.description || billingCategoryLabel(category) })}
            />
          </View>
        </View>

        {/* Frequência: Modalidade */}
        <View className="gap-2">
          <SectionLabel>Modalidade de Pagamento</SectionLabel>
          <View className="flex-row gap-2">
            {TYPES.map((option) => (
              <TypeButton
                key={option.value}
                label={option.label}
                active={draft.type === option.value}
                disabled={locked || scheduled}
                onPress={() => update({ type: option.value, frequency: option.value === "until" ? BillingFrequency.Monthly : draft.frequency, end: "" })}
              />
            ))}
          </View>
          {draft.type === "until" && (
            <View className="gap-1">
              <SectionLabel>Parcelas</SectionLabel>
              <TextInput
                accessibilityLabel="Parcelas"
                editable={!locked && !scheduled}
                inputMode="numeric"
                placeholder="2 a 120"
                placeholderTextColor={colors.muted}
                value={draft.occurrences}
                onChangeText={(value) => update({ occurrences: value })}
                className="h-11 rounded-[14px] border border-outline bg-surface px-3.5 py-0 font-sans text-[15px] tracking-normal text-ink"
              />
            </View>
          )}
          {draft.type === "indefinite" && (
            <View className="flex-row gap-2">
              <Chip label="Mensal" active={draft.frequency === "monthly"} disabled={locked || scheduled} onPress={() => update({ frequency: BillingFrequency.Monthly })} />
              <Chip label="Anual" active={draft.frequency === "yearly"} disabled={locked || scheduled} onPress={() => update({ frequency: BillingFrequency.Yearly })} />
            </View>
          )}
        </View>

        {/* Frequência: Vencimento */}
        <View className="gap-2">
          <SectionLabel>{scheduled ? "Próximo vencimento" : "Data de Vencimento"}</SectionLabel>
          <View className="flex-row items-center gap-2">
            {monthEnd ? (
              <View className="flex-1">
                <MonthSelect value={draft.start} today={today} disabled={locked || dueLocked} onSelect={(value) => update({ start: value })} />
              </View>
            ) : (
              <TextInput
                accessibilityLabel="Vencimento"
                editable={!locked && !dueLocked}
                placeholder="AAAA-MM-DD"
                placeholderTextColor={colors.muted}
                value={draft.start}
                onChangeText={(value) => update({ start: value })}
                className="h-11 flex-1 rounded-xl border border-outline/50 bg-surface px-3.5 py-0 text-[14px] font-semibold text-ink"
              />
            )}
            {QUICK_DUE.map((option) => (
              <Pressable
                key={option.label}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: !monthEnd && draft.start === addCalendarDays(today, option.days), disabled: locked || dueLocked }}
                disabled={locked || dueLocked}
                onPress={() => update({ start: addCalendarDays(today, option.days), dueRule: BillingDueRule.Fixed })}
                className={`h-11 items-center justify-center rounded-xl border px-3.5 ${
                  !monthEnd && draft.start === addCalendarDays(today, option.days) ? "border-primary/30 bg-primary-soft/60" : "border-outline/40 bg-surface-muted"
                } ${locked || dueLocked ? "opacity-50" : ""}`}
              >
                <Text className="text-xs font-semibold text-primary-strong">{option.label}</Text>
              </Pressable>
            ))}
            {monthEnds && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Final do mês"
                accessibilityState={{ selected: monthEnd, disabled: locked || dueLocked }}
                disabled={locked || dueLocked}
                onPress={toggleMonthEnd}
                className={`h-11 items-center justify-center rounded-xl border px-3.5 ${monthEnd ? "border-primary/30 bg-primary-soft/60" : "border-outline/40 bg-surface-muted"} ${
                  locked || dueLocked ? "opacity-50" : ""
                }`}
              >
                <Text className="text-xs font-semibold text-primary-strong">Final do mês</Text>
              </Pressable>
            )}
            {!monthEnd && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Abrir calendário"
                accessibilityState={{ expanded: calendarOpen, disabled: locked || dueLocked }}
                disabled={locked || dueLocked}
                onPress={() => setCalendarOpen((open) => !open)}
                className={`h-11 w-11 items-center justify-center rounded-xl border border-outline/50 bg-surface ${locked || dueLocked ? "opacity-50" : ""}`}
              >
                <Image source={calendarMark} tintColor={colors.primaryStrong} style={{ width: 20, height: 20 }} />
              </Pressable>
            )}
          </View>
          {calendarOpen && Platform.OS !== "ios" && (
            <DateTimePicker
              accessibilityLabel="Calendário"
              value={dateFromCalendar(draft.start, today)}
              mode="date"
              minimumDate={minimumDate}
              display="default"
              themeVariant={scheme === "dark" ? "dark" : "light"}
              onValueChange={pickDate}
              onDismiss={() => setCalendarOpen(false)}
            />
          )}
          {calendarOpen && Platform.OS === "ios" && (
            <Modal transparent animationType="slide" visible onRequestClose={() => setCalendarOpen(false)}>
              <Pressable className="flex-1 justify-end bg-scrim" onPress={() => setCalendarOpen(false)}>
                <Pressable className="gap-2 rounded-t-3xl bg-canvas p-5 pb-10" onPress={() => undefined}>
                  <Text accessibilityRole="header" className="text-lg font-semibold text-primary-strong">
                    Data de vencimento
                  </Text>
                  <DateTimePicker
                    accessibilityLabel="Calendário"
                    value={dateFromCalendar(draft.start, today)}
                    mode="date"
                    minimumDate={minimumDate}
                    display="inline"
                    locale="pt-BR"
                    accentColor={colors.primary}
                    themeVariant={scheme === "dark" ? "dark" : "light"}
                    onValueChange={pickDate}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Concluir"
                    onPress={() => setCalendarOpen(false)}
                    className="h-12 items-center justify-center rounded-xl bg-primary"
                  >
                    <Text className="text-sm font-bold text-on-primary">Concluir</Text>
                  </Pressable>
                </Pressable>
              </Pressable>
            </Modal>
          )}
        </View>

        {/* Divisão slot: quem está do outro lado — o contato que recebe uma conta a pagar, ou quem pagou um registro a receber */}
        {(payable || settled) && (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-[11px] font-semibold uppercase tracking-[0.88px] text-muted">{SETTLED_LABELS[draft.direction].field}</Text>
              {!seatLocked && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Escolher contato"
                  accessibilityState={{ disabled: locked || frozen }}
                  disabled={locked || frozen}
                  onPress={() => setPicker(true)}
                  className="min-h-10 flex-row items-center gap-1 px-1"
                >
                  <Image source={closeMark} tintColor={colors.primaryStrong} style={{ width: 14, height: 14 }} />
                  <Text className="text-xs font-semibold text-primary">{seated ? "Trocar" : "Escolher"}</Text>
                </Pressable>
              )}
            </View>

            {seated ? (
              <View className="flex-row flex-wrap gap-2">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={seated.displayName}
                  accessibilityHint="Remove da conta"
                  accessibilityState={{ selected: true, disabled: locked || frozen || seatLocked }}
                  disabled={locked || frozen || seatLocked}
                  onPress={clearSeat}
                  className="flex-row items-center gap-1.5 rounded-full border border-outline/40 bg-surface py-1 pl-1 pr-2"
                >
                  <InitialsAvatar name={seated.displayName} size={24} avatar={seated.avatar} />
                  <Text className="text-xs font-semibold text-ink">{seated.displayName}</Text>
                  {!seatLocked && <Image source={closeMark} tintColor={colors.muted} style={{ width: 12, height: 12, transform: [{ rotate: "45deg" }] }} />}
                </Pressable>
              </View>
            ) : (
              <Text className="text-[11px] text-muted">{SEAT_HINTS[draft.direction]}</Text>
            )}
          </View>
        )}

        {/* Divisão slot, conta a receber: split-mode tabs + participant list */}
        {!payable && !settled && (
          <Card>
            <View className="flex-row items-center justify-between gap-2">
              <Text className="font-sans text-[11px] font-semibold uppercase tracking-[0.88px] text-muted">Divisão da Conta</Text>
              <Text className="rounded-full bg-primary-soft/40 px-2 py-0.5 text-[11px] font-semibold text-primary" numberOfLines={1}>
                {splitTag()}
              </Text>
            </View>
            <View className="flex-row flex-wrap gap-1.5">
              {SPLIT_MODES.map((option) => (
                <Segment
                  key={option.value}
                  variant="ink"
                  label={option.label}
                  name={option.name}
                  active={draft.mode === option.value}
                  disabled={locked || frozen}
                  onPress={() => update({ mode: option.value })}
                />
              ))}
            </View>
            <SplitEditor mode={draft.mode} rows={rows} hint={hint ?? ""} disabled={locked || frozen} onChange={changeSplitValue} />
          </Card>
        )}

        {/* Divisão slot, conta a receber: Adicionar pessoa below the list, then the Não notificar switches and Eu também participo */}
        {!payable && !settled && (
          <View className="gap-3">
            <View className="flex-row items-center gap-1.5">
              <Text className="font-sans text-[11px] font-semibold uppercase tracking-[0.88px] text-muted">Participantes</Text>
              <Text className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-muted">
                {participants} pessoa{participants === 1 ? "" : "s"}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Adicionar"
              accessibilityState={{ disabled: locked || frozen }}
              disabled={locked || frozen}
              onPress={() => setPicker(true)}
              className="min-h-10 flex-row items-center gap-2 px-1"
            >
              <View className="h-7 w-7 items-center justify-center rounded-full border border-dashed border-primary">
                <Image source={closeMark} tintColor={colors.primary} style={{ width: 13, height: 13 }} />
              </View>
              <Text className="font-sans text-[12.5px] font-semibold text-primary">Adicionar pessoa</Text>
            </Pressable>

            {chosen.length > 0 && (
              <View className="flex-row flex-wrap gap-2">
                {chosen.map((contact) => (
                  <Pressable
                    key={contact.userId}
                    accessibilityRole="button"
                    accessibilityLabel={contact.displayName}
                    accessibilityHint="Remove da cobrança"
                    accessibilityState={{ selected: true, disabled: locked || frozen }}
                    disabled={locked || frozen}
                    onPress={() => toggle(contact.userId)}
                    className="flex-row items-center gap-1.5 rounded-full border border-outline/40 bg-surface py-1 pl-1 pr-2"
                  >
                    <InitialsAvatar name={contact.displayName} size={24} avatar={contact.avatar} />
                    <Text className="text-xs font-semibold text-ink">{contact.displayName}</Text>
                    <Image source={closeMark} tintColor={colors.muted} style={{ width: 12, height: 12, transform: [{ rotate: "45deg" }] }} />
                  </Pressable>
                ))}
              </View>
            )}

            {notifiable.length > 0 && (
              <View className="gap-2">
                {notifiable.map((contact) => (
                  <View key={contact.userId} className="flex-row items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface px-3 py-2.5">
                    <View className="flex-1 flex-row items-center gap-2.5">
                      <InitialsAvatar name={contact.displayName} size={24} avatar={contact.avatar} />
                      <View className="flex-1">
                        <Text className="text-xs font-semibold text-ink" numberOfLines={1}>
                          {contact.displayName}
                        </Text>
                        <Text className="text-[11px] text-muted">Não notificar</Text>
                      </View>
                    </View>
                    <Switch
                      accessibilityLabel={`Não notificar ${contact.displayName}`}
                      disabled={locked || frozen}
                      value={draft.notify?.[contact.userId] === false}
                      onValueChange={(value) => switchNotify(contact.userId, value)}
                      trackColor={{ true: colors.primary }}
                    />
                  </View>
                ))}
                <Text className="text-[11px] text-muted">Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.</Text>
              </View>
            )}

            <View className="flex-row items-center justify-between rounded-xl border border-outline/30 bg-surface-muted/80 p-3">
              <View className="flex-1 flex-row items-center gap-2.5">
                <View className="h-8 w-8 items-center justify-center rounded-lg bg-surface">
                  <InitialsAvatar name="Eu" size={20} inverted />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-semibold text-ink">Eu também participo da divisão</Text>
                  <Text className="text-[11px] text-muted">Você entra no cálculo como um dos pagadores</Text>
                </View>
              </View>
              <Switch
                accessibilityLabel="Eu também participo"
                disabled={locked || frozen}
                value={draft.owner}
                onValueChange={(value) => update({ owner: value })}
                trackColor={{ true: colors.primary }}
              />
            </View>
          </View>
        )}

        {/* Chave Pix: the owner's own keys on a conta a receber, the seated contact's on a conta a pagar */}
        {!settled && (!payable || Boolean(seatedPayee)) && (
          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <SectionLabel>{pixTitle}</SectionLabel>
              {!payable && !editing && !gated && onCreatePix && (
                <Pressable accessibilityRole="button" accessibilityLabel="Cadastrar chave" disabled={locked} onPress={() => leaveTo(onCreatePix)} className="min-h-8 justify-center">
                  <Text className="text-[11px] font-medium text-primary">+ Cadastrar nova chave</Text>
                </Pressable>
              )}
            </View>
            {payable && payeeLoaded && !methods.length ? (
              <View className="gap-2 rounded-2xl border border-outline/40 bg-surface p-3.5">
                <Text className="text-xs leading-5 text-muted">{NO_CONTACT_KEY}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cadastrar chave"
                  accessibilityState={{ disabled: locked || !onEditContact }}
                  disabled={locked || !onEditContact}
                  onPress={leaveToContactKeys}
                  className="min-h-9 justify-center"
                >
                  <Text className="text-xs font-bold text-primary">Cadastrar chave</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Trocar chave Pix"
                accessibilityState={{ disabled: locked || !switchable }}
                disabled={locked || !switchable}
                onPress={() => setPixOpen(true)}
                className="flex-row items-center justify-between rounded-2xl border border-outline bg-surface px-3.5 py-3"
              >
                <View className="flex-1 flex-row items-center gap-3">
                  <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary-soft">
                    <Image source={selectedPix ? iconOf(selectedPix) : keyMark} tintColor={colors.primaryStrong} style={{ width: 18, height: 18 }} />
                  </View>
                  <View className="flex-1">
                    <Text className="font-sans text-[13.5px] font-semibold text-ink" numberOfLines={1}>
                      {selectedPix ? `${paymentMethodText(selectedPix).title}: ${abbreviate(paymentMethodText(selectedPix).value)}` : "Selecionar meio de pagamento"}
                    </Text>
                    <Text className="text-[11px] text-muted" numberOfLines={1}>
                      {selectedPix ? (selectedPix.isDefault ? "Meio padrão" : "Meio secundário") : methods.length ? "Toque para escolher" : "Nenhum meio cadastrado"}
                    </Text>
                  </View>
                </View>
                {switchable && <Image source={chevronMark} tintColor={colors.muted} style={{ width: 16, height: 16, transform: [{ rotate: "90deg" }] }} />}
              </Pressable>
            )}
          </View>
        )}

        {pixOpen && (
          <Modal transparent animationType="slide" visible onRequestClose={() => setPixOpen(false)}>
            <Pressable className="flex-1 justify-end bg-scrim" onPress={() => setPixOpen(false)}>
              <Pressable className="max-h-[80%] gap-2 rounded-t-3xl bg-canvas p-5 pb-10" onPress={() => undefined}>
                <Text accessibilityRole="header" className="text-lg font-semibold text-primary-strong">
                  {pixTitle}
                </Text>
                <ScrollView contentContainerClassName="gap-2" showsVerticalScrollIndicator={false}>
                  {methods.map((method) => {
                    const active = payingPix === method.id;
                    const text = paymentMethodText(method);

                    return (
                      <Pressable
                        key={method.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${text.title} · ${abbreviate(text.value)}`}
                        accessibilityState={{ selected: active }}
                        onPress={() => {
                          update({ pix: method.id });
                          setPixOpen(false);
                        }}
                        className={`min-h-16 flex-row items-center gap-3 rounded-2xl border px-4 py-3 ${active ? "border-primary bg-primary-soft/40" : "border-outline/40 bg-surface"}`}
                      >
                        <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary-soft">
                          <Image source={iconOf(method)} tintColor={colors.primaryStrong} style={{ width: 18, height: 18 }} />
                        </View>
                        <View className="flex-1">
                          <View className="flex-row items-center gap-2">
                            <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                              {text.title}
                            </Text>
                            {method.isDefault && <Text className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-muted">Padrão</Text>}
                          </View>
                          <Text className="text-[11px] text-muted" numberOfLines={1}>
                            {text.value}
                          </Text>
                        </View>
                        {active && <Image source={checkMark} tintColor={colors.primaryStrong} style={{ width: 18, height: 18 }} />}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </Pressable>
            </Pressable>
          </Modal>
        )}

        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-danger-soft p-4 text-danger">
            {error}
          </Text>
        ) : null}
        {attempt?.uncertain && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={retry}
            disabled={busy}
            onPress={submit}
            className="min-h-12 items-center justify-center rounded-xl border border-outline"
          >
            <Text className="font-bold text-primary">{retry}</Text>
          </Pressable>
        )}
          </>
        )}
      </ScrollView>

      {!blocked && (
      <View className="absolute bottom-0 left-0 right-0 border-t border-outline/60 bg-canvas px-5 pb-8 pt-3.5">
        {footerSummary && (
          <View className="mb-2.5 flex-row items-center justify-between gap-2">
            <Text className="font-sans text-xs text-muted">{billingDraftSummaryText(footerSummary)}</Text>
            <Text className="font-display text-sm font-bold text-ink">
              {footerSummary.occurrences === null ? `${money(footerSummary.perOccurrenceCents)}/mês` : money(footerSummary.totalCents)}
            </Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action}
          disabled={busy}
          onPress={submit}
          className={`h-[54px] items-center justify-center rounded-2xl bg-ink ${busy ? "opacity-50" : ""}`}
        >
          {busy ? <ActivityIndicator color={colors.surface} /> : <Text className="font-sans text-[15.5px] font-bold text-surface">{action}</Text>}
        </Pressable>
      </View>
      )}

      {picker && (
        <ContactPickerSheet
          selected={seating ? (seatId ? [seatId] : []) : draft.selected}
          by={payable ? "id" : "userId"}
          contacts={contacts}
          onToggle={seating ? seat : (contact) => toggle(contact.userId)}
          onSeen={remember}
          onClose={() => setPicker(false)}
          onNew={
            editing || !onCreateContact
              ? undefined
              : () => {
                  setPicker(false);
                  leaveTo(onCreateContact);
                }
          }
        />
      )}

      {scopeAttempt && billing && (
        <ScopeModal
          title="Aplicar às cobranças deste mês?"
          explanation={editScopeExplanation(editableMonthCharges(billing, todayIn(billing.timezone)).length, todayIn(billing.timezone))}
          primaryLabel="Aplicar também às deste mês"
          secondaryLabel="Só a partir do mês seguinte"
          busy={busy}
          onPrimary={() => applyScope(EditScope.CurrentMonth)}
          onSecondary={() => applyScope()}
          onCancel={() => setScopeAttempt(null)}
        />
      )}
    </SafeAreaView>
  );
}
