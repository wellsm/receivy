import {
  billingCategoryColor,
  billingCategoryLabel,
  buildBillingInput,
  calendarDate,
  canNotifyContact,
  directionLine,
  draftTotalCents,
  editableMonthCharges,
  editScopeExplanation,
  EditScope,
  EMPTY_BILLING_DRAFT,
  EMPTY_SPLIT_VALUES,
  firstNoticeDate,
  firstNoticeSentence,
  formatMoney,
  parseBRLCents,
  previewBillingSplit,
  receiptSentence,
  reminderRowLabel,
  reminderSummary,
  repetitionLabel,
  shouldAskEditScope,
  splitCountLabel,
  splitFooterLine,
  splitParties,
  splitPartyKey,
  splitSummaryLine,
  untilInstallmentPreview,
  UserStatus,
  type BillingDetail,
  type BillingDraft,
  BillingDueRule,
  BillingFrequency,
  type BillingInput,
  BillingKind,
  type BillingPatch,
  BillingRecurrence,
  type Contact,
  Direction,
  paymentMethodText,
  PaymentProvider,
  PlanTier,
  type PaymentMethod,
  type PixKeyType,
  type ReminderRule,
  SYSTEM_REMINDER_CONFIG,
  SplitPartKind,
  type SplitLine,
  type SplitValues,
} from "@receivy/common";
import * as Crypto from "expo-crypto";
import { useFocusEffect, useNavigation } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { BottomSheet } from "@/components/app/bottom-sheet";
import { ContactPickerSheet } from "@/components/app/contact-picker-sheet";
import { ReminderEditor, ReminderPreview } from "@/components/app/reminder-editor";
import { ScopeModal } from "@/components/app/scope-modal";
import { CategoryIcon } from "@/components/ui/category-icon";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { accountClient, type AccountClient } from "@/account/client";
import { financialClient, FinancialRequestError, type FinancialClient } from "@/financial/client";
import { clearDraft, parkedStepOf, saveDraft, takeDraft } from "@/financial/draft-store";
import { PLAN_SITE_SUFFIX } from "@/financial/plan-copy";
import { contactsClient } from "@/contacts/client";
import { useThemeColors } from "@/theme/colors";
import { visibleChannels, whatsappEnabled } from "@/whatsapp-flag";
import { DetailCard, DetailRow } from "./billing/detail-row";
import { AmountTitleFields, isCalendarDate, RepeatFields, SectionLabel, Segmented, DIRECTIONS, SETTLED_LABELS } from "./billing/schedule-fields";
import { SeatPanel, SplitPanel, type SplitPerson } from "./billing/split-panel";

const closeMark = require("../../../assets/images/auth/plus.svg");
const chevronMark = require("../../../assets/images/auth/chevron.svg");
const keyMark = require("../../../assets/images/auth/key.svg");
const calendarMark = require("../../../assets/images/auth/calendar.svg");
const groupMark = require("../../../assets/images/auth/group.svg");
const bellMark = require("../../../assets/images/auth/bell.svg");
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

type Client = Pick<FinancialClient, "paymentMethods" | "profile" | "createBilling" | "patchBilling"> & Partial<Pick<FinancialClient, "plan">>;
type Attempt = { input: BillingInput; key: string; uncertain: boolean; applyTo?: EditScope };
type Step = 1 | 2 | 3;
/** Which panel is lifted over the screen: the edit opens every row in one, the review opens the two defaults. */
type Sheet = "repeat" | "split" | "reminders" | "pix" | null;

type BillingFormScreenProps = {
  client?: Client;
  contacts?: Pick<typeof contactsClient, "list">;
  /** The owner's reminder default: only read on a brand-new billing, to seed `effective`. */
  account?: Pick<AccountClient, "reminders">;
  billing?: BillingDetail | null;
  onSaved: (billing: BillingDetail) => void;
  /** Where × goes; absent, the screen pops itself. */
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
const SETTLED_HELP = "Registro já quitado: ninguém recebe aviso. Cada ocorrência fica paga no vencimento.";
const SETTLED_LOCKED = "Não dá para mudar depois de criada.";

const STEP_TITLES: Record<Step, string> = { 1: "Nova conta", 2: "Divisão", 3: "Revisar" };
const CONTINUE_LABELS: Record<Step, string> = { 1: "Continuar · divisão", 2: "Continuar · revisar", 3: "Criar conta" };

/** The counterpart seat, by direction: a conta a pagar names who receives, a registro who paid. */
const SEAT_LABELS: Record<Direction, string> = { receivable: "De quem", payable: "Para quem" };
const SEAT_HINTS: Record<Direction, string> = { receivable: "Escolha quem pagou.", payable: "Escolha quem recebe." };

function money(amountCents: number): string {
  return formatMoney({ amountCents, currency: "BRL" });
}

function moneyText(amountCents: number): string {
  return money(amountCents).replace(/[^\d,]/g, "");
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
    reminders: billing.reminders ? billing.reminders.map((reminder) => ({ ...reminder, offsetDays: String(reminder.offsetDays) })) : null,
    notify: notifyFromBilling(billing),
    settled: billing.kind === BillingKind.Record,
  };
}

/** A seated user the agenda has not shown yet (a stale draft, a contact removed meanwhile): the row still needs a face. */
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
  return pixKey.length <= 18 ? pixKey : `${pixKey.slice(0, 7)}…${pixKey.slice(-7)}`;
}

/** The typed amount, or zero while it cannot be read: a parcelado still types its total here. */
function typedCents(draft: BillingDraft): number {
  try {
    return parseBRLCents(draft.amount);
  } catch {
    return 0;
  }
}

function Card({ children }: { children: ReactNode }) {
  return <View className="gap-3 rounded-[20px] border border-outline bg-surface p-4">{children}</View>;
}

/** The three-segment bar under the step header. */
function Progress({ step }: { step: Step }) {
  return (
    <View accessibilityLabel={`Passo ${step} de 3`} className="flex-row gap-1.5 px-5 pb-3">
      {[1, 2, 3].map((index) => (
        <View key={index} className={`h-1 flex-1 rounded-full ${index <= step ? "bg-primary" : "bg-outline"}`} />
      ))}
    </View>
  );
}

export function BillingFormScreen({
  client = financialClient,
  contacts = contactsClient,
  account = accountClient,
  billing = null,
  onSaved,
  onBack,
  onCreateContact,
  onEditContact,
  onCreatePix,
}: BillingFormScreenProps) {
  const navigation = useNavigation();
  const colors = useThemeColors();
  const [draft, setDraft] = useState<BillingDraft>(() =>
    billing ? draftFromBilling(billing) : EMPTY_BILLING_DRAFT("America/Sao_Paulo", calendarDate()),
  );
  const [step, setStep] = useState<Step>(1);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [recent, setRecent] = useState<Contact[]>([]);
  const [directory, setDirectory] = useState<Contact[]>([]);
  /** The owner's own keys: what a conta a receber is paid through. */
  const [wallet, setWallet] = useState<PaymentMethod[]>([]);
  /** The seated contact's keys, tagged with whose they are: an unanswered seat reads as none. */
  const [payeeKeys, setPayeeKeys] = useState<{ contactId: string; methods: PaymentMethod[] }>({ contactId: "", methods: [] });
  const [picker, setPicker] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [scopeAttempt, setScopeAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [gated, setGated] = useState(false);
  const [plan, setPlan] = useState<PlanTier>(PlanTier.Free);
  // What actually fires while the draft inherits the default: the billing's own effective reminders on
  // edit, the owner's account default on creation (fetched below, falling back to the system one).
  // WhatsApp is not wired up here yet, so it never unlocks.
  const [effective, setEffective] = useState<ReminderRule[]>(() => billing?.effectiveReminders ?? SYSTEM_REMINDER_CONFIG.reminders);
  const loaded = useRef(false);

  const whatsappGate = { available: false, planAllows: plan === PlanTier.Basic };

  useEffect(() => {
    let live = true;

    client.plan?.().then(
      (summary) => live && setPlan(summary.plan),
      () => undefined,
    );

    return () => {
      live = false;
    };
  }, [client]);

  useEffect(() => {
    // Editing already carries the billing's own effective reminders; a creation has none yet, so
    // the inherited summary reads the owner's account default, falling back to the system one.
    if (billing) {
      return;
    }

    let live = true;

    account.reminders().then(
      (settings) => live && setEffective(settings.config.reminders),
      () => undefined,
    );

    return () => {
      live = false;
    };
  }, [account, billing]);

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
  // Who sits on the other side: the contact a conta a pagar pays, or the single person who paid a registro a receber.
  const seating = payable || settled;

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

      if (stored) {
        const parked = parkedStepOf();

        setStep(parked === 2 || parked === 3 ? parked : 1);
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

  /** The bell of a participant: off means "Não notificar", which the draft stores as `false`. */
  function switchNotify(userId: string, notify: boolean) {
    update({ notify: { ...draft.notify, [userId]: notify } });
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
    saveDraft(draft, step);
    setSheet(null);
    go();
  }

  /** The key of a conta a pagar lives on the contact: the hint sends the owner there and back. */
  function leaveToContactKeys() {
    if (!onEditContact) {
      return;
    }

    // An edit is not restorable from a parked draft: only a creation leaves one behind.
    if (editing) {
      setSheet(null);
      onEditContact(draft.payee);

      return;
    }

    leaveTo(() => onEditContact(draft.payee));
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
      ...(input.reminders ? { reminders: input.reminders } : billing?.reminders ? { clearReminders: true } : {}),
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
      // Never send a bell for a participant the agenda no longer shows as reachable: the bell does
      // not render for them, so a stale value seeded from editing must not travel either.
      const notify = draft.notify && Object.fromEntries(Object.entries(draft.notify).filter(([userId]) => notifiableIds.has(userId)));
      // The kill switch off never lets a whatsapp channel out, whatever the picker showed before it flipped.
      const reminders = whatsappEnabled() || !draft.reminders ? draft.reminders : draft.reminders.map((rule) => ({ ...rule, channels: { email: true, whatsapp: false } }));
      // Only a creation checks that a recorrente registro starts today or later.
      const next: Attempt = {
        input: buildBillingInput({ ...draft, notify, pix: payingKey(), reminders }, billing ? undefined : new Date()),
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
  const totalCents = draftTotalCents(draft);
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
  const seatId = payable ? draft.payee : (draft.selected[0] ?? "");
  const seated = seatId ? (payable ? contactById(seatId) : contactOf(seatId)) : null;
  // Nothing reaches a contact without an e-mail or a phone, so the bell never shows for them.
  const notifiable = chosen.filter(canNotifyContact);
  const notifiableIds = new Set(notifiable.map((contact) => contact.userId));

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
  const remainder = draft.mode === "fixed" && draft.owner ? ownerRemainderCents() : null;
  // The keys the split actually prices: every participant, plus the owner while they take part (never typed on a fixed split).
  const splitKeys = (draft.mode === "fixed" ? draft.selected.map((userId) => ({ kind: SplitPartKind.User, userId })) : splitParties(draft)).map(splitPartyKey);

  const people: SplitPerson[] = [
    ...chosen.map((contact) => ({
      key: contact.userId,
      name: contact.displayName,
      avatar: contact.avatar,
      owner: false,
      amountCents: amounts[contact.userId],
      value: modeValues[contact.userId] ?? "",
      notifiable: canNotifyContact(contact),
      notify: draft.notify?.[contact.userId] !== false,
    })),
    {
      key: "owner",
      name: "Eu",
      owner: true,
      amountCents: remainder ?? amounts.owner,
      value: modeValues.owner ?? "",
      notifiable: false,
      notify: false,
      readonlyText: draft.mode === "fixed" && draft.owner && remainder !== null ? `Você fica com ${money(remainder)}` : undefined,
    },
  ];

  /** Everyone with a priced share, named for the review copy. */
  const lines: SplitLine[] = people.flatMap((person) => {
    if (person.owner && !draft.owner) {
      return [];
    }

    const amountCents = person.owner ? (remainder ?? amounts.owner) : amounts[person.key];

    return amountCents === undefined ? [] : [{ name: person.name, amountCents, owner: person.owner }];
  });

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
  const pixTitle = payable ? "Pagar via Pix" : "Receber por";
  const pixText = selectedPix ? paymentMethodText(selectedPix) : null;
  const pixValue = pixText ? `${pixText.title} · ${abbreviate(pixText.value)}` : payable && payeeLoaded && !methods.length ? "Sem chave no contato" : "Nenhum meio escolhido";
  const visibleEffective = effective.map((rule) => ({ ...rule, channels: visibleChannels(rule.channels) }));
  const activeReminders: ReminderRule[] = draft.reminders ? draft.reminders.map((rule) => ({ ...rule, offsetDays: Number(rule.offsetDays) || 0 })) : effective;
  const remindersValue = reminderRowLabel(draft.reminders === null, activeReminders, reminderSummary(visibleEffective));
  // Who gets an automatic notice: reachable participants whose bell is on.
  const noticed = notifiable.filter((contact) => draft.notify?.[contact.userId] !== false).map((contact) => contact.displayName);
  const noticeDate = !payable && !settled && noticed.length ? firstNoticeDate(draft.start, activeReminders) : null;
  const retry = editing ? "Tentar salvar novamente" : "Tentar criar novamente";

  /** What still blocks leaving the current step, phrased like the shared builder does. */
  function stepError(): string | null {
    if (step === 1) {
      if (typedCents(draft) <= 0) {
        return "Informe o valor.";
      }

      if (!draft.description.trim()) {
        return "Dê um título à conta.";
      }

      if (!isCalendarDate(draft.start)) {
        return "Informe a data como AAAA-MM-DD.";
      }

      if (draft.type === BillingRecurrence.Until && !untilInstallmentPreview(draft)) {
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

  function back() {
    setError("");

    if (!editing && step > 1) {
      setStep((current) => (current === 3 ? 2 : 1));

      return;
    }

    clearDraft();

    if (onBack) {
      onBack();

      return;
    }

    navigation.goBack();
  }

  const title = editing ? "Editar conta" : step === 2 && seating ? SEAT_LABELS[draft.direction] : STEP_TITLES[step];
  const closing = editing || step === 1;
  const action = editing ? "Salvar conta" : step === 3 ? (noticeDate ? "Criar conta e avisar" : "Criar conta") : CONTINUE_LABELS[step];

  function renderSplit(inSheet: boolean) {
    if (seating) {
      return (
        <SeatPanel
          label={SEAT_LABELS[draft.direction]}
          hint={SEAT_HINTS[draft.direction]}
          seated={seated}
          locked={seatLocked}
          disabled={locked || frozen}
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
        totalCents={inSheet ? 0 : totalCents}
        disabled={locked || frozen}
        onMode={(mode) => update({ mode })}
        onValue={changeSplitValue}
        onNotify={switchNotify}
        onRemove={toggle}
        onOwner={(owner) => update({ owner })}
        onAdd={() => setPicker(true)}
      />
    );
  }

  function renderReminders() {
    if (draft.reminders === null) {
      return (
        <View className="flex-row items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface px-3 py-2.5">
          <Text className="flex-1 font-sans text-sm text-ink">Usando seu padrão: {reminderSummary(visibleEffective)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Personalizar"
            accessibilityState={{ disabled: locked }}
            disabled={locked}
            onPress={() => update({ reminders: effective.map((rule) => ({ ...rule, offsetDays: String(rule.offsetDays) })) })}
          >
            <Text className="font-sans text-sm font-semibold text-primary">Personalizar</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <>
        <ReminderEditor rules={draft.reminders} onChange={(reminders) => update({ reminders })} whatsapp={whatsappGate} disabled={locked} />
        <ReminderPreview rules={draft.reminders} dueDate={draft.start || today} />
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar ao padrão" accessibilityState={{ disabled: locked }} disabled={locked} onPress={() => update({ reminders: null })} className="self-start">
          <Text className="font-sans text-sm font-semibold text-muted">Voltar ao padrão</Text>
        </Pressable>
      </>
    );
  }

  function renderPix() {
    if (payable && payeeLoaded && !methods.length) {
      return (
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
      );
    }

    return (
      <>
        {!methods.length && <Text className="text-xs leading-5 text-muted">Nenhum meio cadastrado.</Text>}
        {methods.map((method) => {
          const active = payingPix === method.id;
          const text = paymentMethodText(method);

          return (
            <Pressable
              key={method.id}
              accessibilityRole="button"
              accessibilityLabel={`${text.title} · ${abbreviate(text.value)}`}
              accessibilityState={{ selected: active, disabled: locked }}
              disabled={locked}
              onPress={() => {
                update({ pix: method.id });
                setSheet(null);
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
        {!payable && !editing && !gated && onCreatePix && (
          <Pressable accessibilityRole="button" accessibilityLabel="Cadastrar chave" disabled={locked} onPress={() => leaveTo(onCreatePix)} className="min-h-10 justify-center">
            <Text className="text-[13px] font-semibold text-primary">+ Cadastrar nova chave</Text>
          </Pressable>
        )}
      </>
    );
  }

  /** The two rows every conta shares, on the review and on the edit screen. */
  function renderDefaultRows() {
    if (settled) {
      return null;
    }

    return (
      <>
        <DetailRow icon={bellMark} tone="muted" label="Lembretes" value={remindersValue} onPress={() => setSheet("reminders")} disabled={locked} />
        {(!payable || Boolean(seatedPayee)) && (
          <DetailRow
            icon={keyMark}
            tone="success"
            label={pixTitle}
            value={pixValue}
            onPress={payable && payeeLoaded && !methods.length ? (onEditContact ? leaveToContactKeys : undefined) : () => setSheet("pix")}
            disabled={locked}
          />
        )}
      </>
    );
  }

  function renderReview() {
    const splitValue = seating ? (seated ? seated.displayName : SEAT_HINTS[draft.direction]) : lines.length ? splitSummaryLine(lines) : splitCountLabel(draft, splitKeys);

    return (
      <>
        <Card>
          <View className="flex-row items-center gap-3">
            <View className="h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: `${billingCategoryColor(draft.category)}1F` }}>
              <CategoryIcon category={draft.category} size={20} />
            </View>
            <View className="flex-1">
              <Text className="font-sans text-[15px] font-bold text-ink" numberOfLines={1}>
                {draft.description || billingCategoryLabel(draft.category)}
              </Text>
              <Text className="font-sans text-[12.5px] text-muted">{directionLine(draft)}</Text>
            </View>
            <Text className="font-display text-[19px] font-bold text-ink">{money(typedCents(draft))}</Text>
          </View>
        </Card>

        <View className="gap-2">
          <SectionLabel>Do que você preencheu</SectionLabel>
          <DetailCard>
            <DetailRow icon={calendarMark} label="Repetição · passo 1" value={repetitionLabel(draft)} action="edit" onPress={() => setStep(1)} disabled={locked} />
            <DetailRow icon={groupMark} label={`${seating ? SEAT_LABELS[draft.direction] : "Divisão"} · passo 2`} value={splitValue} action="edit" onPress={() => setStep(2)} disabled={locked} />
          </DetailCard>
        </View>

        {!settled && (
          <View className="gap-2">
            <SectionLabel>Já configurado pelo padrão</SectionLabel>
            <DetailCard>{renderDefaultRows()}</DetailCard>
          </View>
        )}

        {noticeDate && (
          <View className="rounded-2xl bg-primary-soft/60 px-4 py-3">
            <Text className="font-sans text-[13px] leading-5 text-primary-strong">{firstNoticeSentence(noticed, noticeDate, Boolean(selectedPix))}</Text>
          </View>
        )}
      </>
    );
  }

  function renderEdit() {
    const counterpart = seated?.displayName ?? billing?.counterpart?.name ?? null;
    const summary = receiptSentence(draft, lines, counterpart);
    const splitValue = seating ? (seated ? seated.displayName : SEAT_HINTS[draft.direction]) : splitCountLabel(draft, splitKeys);

    return (
      <>
        {frozen && <Text className="rounded-2xl bg-primary-soft/50 p-4 text-sm text-primary-strong">{FROZEN_NOTE}</Text>}
        {/* A registro stays one: the switch shows locked, so the screen still says what this conta is. */}
        {settled && (
          <View className="flex-row items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface px-3 py-1.5">
            <View className="flex-1">
              <Text className="text-xs font-semibold text-ink">{SETTLED_LABELS[draft.direction]}</Text>
              <Text className="text-[11px] text-muted">{SETTLED_LOCKED}</Text>
            </View>
            <Switch accessibilityLabel={SETTLED_LABELS[draft.direction]} accessibilityState={{ disabled: true }} disabled value trackColor={{ true: colors.primary }} />
          </View>
        )}
        <Card>
          <AmountTitleFields draft={draft} locked={locked} frozen={frozen} onChange={update} />
        </Card>

        <View className="gap-2">
          <SectionLabel>Detalhes</SectionLabel>
          <DetailCard>
            <DetailRow icon={calendarMark} label="Repetição" value={repetitionLabel(draft)} onPress={() => setSheet("repeat")} disabled={locked} />
            <DetailRow
              icon={groupMark}
              label={seating ? SEAT_LABELS[draft.direction] : "Divisão"}
              value={splitValue}
              trailing={
                !seating && chosen.length ? (
                  <View className="flex-row items-center">
                    {chosen.slice(0, 3).map((contact, index) => (
                      <View key={contact.userId} className={index ? "-ml-2" : ""}>
                        <InitialsAvatar name={contact.displayName} size={22} avatar={contact.avatar} />
                      </View>
                    ))}
                    {draft.owner && (
                      <View className="-ml-2">
                        <InitialsAvatar name="Eu" size={22} inverted />
                      </View>
                    )}
                  </View>
                ) : undefined
              }
              onPress={seatLocked ? undefined : () => setSheet("split")}
              disabled={locked || frozen}
            />
            {renderDefaultRows()}
          </DetailCard>
        </View>

        {summary ? (
          <View className="rounded-2xl bg-primary-soft/60 px-4 py-3">
            <Text className="font-sans text-[13px] leading-5 text-primary-strong">{summary}</Text>
          </View>
        ) : null}
      </>
    );
  }

  function renderStep() {
    if (step === 1) {
      return (
        <>
          <Segmented name="Direção" options={DIRECTIONS} value={draft.direction} disabled={locked} onChange={pickDirection} />
          <View className="flex-row items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface px-3 py-1.5">
            <Text className="text-xs font-semibold text-ink">{SETTLED_LABELS[draft.direction]}</Text>
            <Switch
              accessibilityLabel={SETTLED_LABELS[draft.direction]}
              accessibilityState={{ disabled: locked }}
              disabled={locked}
              value={settled}
              onValueChange={(value) => update({ settled: value })}
              trackColor={{ true: colors.primary }}
            />
          </View>
          {settled && <Text className="text-[11px] text-muted">{SETTLED_HELP}</Text>}
          <AmountTitleFields draft={draft} locked={locked} frozen={false} onChange={update} />
          <RepeatFields draft={draft} today={today} locked={locked} scheduled={false} dueLocked={false} onChange={update} />
        </>
      );
    }

    if (step === 2) {
      return renderSplit(false);
    }

    return renderReview();
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3 pt-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closing ? "Fechar" : "Voltar"}
          onPress={back}
          className="h-11 w-11 items-center justify-center rounded-2xl border border-outline bg-surface"
        >
          {closing ? (
            <Image source={closeMark} tintColor={colors.ink} style={{ width: 16, height: 16, transform: [{ rotate: "45deg" }] }} />
          ) : (
            <Image source={chevronMark} tintColor={colors.ink} style={{ width: 16, height: 16, transform: [{ rotate: "180deg" }] }} />
          )}
        </Pressable>
        <Text accessibilityRole="header" className="flex-1 font-display text-[21px] font-bold text-ink">
          {title}
        </Text>
        {!editing && <Text className="font-sans text-[13px] font-semibold text-muted">{step} de 3</Text>}
      </View>
      {!editing && <Progress step={step} />}

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 pb-36 pt-1" showsVerticalScrollIndicator={false}>
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
            <Segmented name="Direção" options={DIRECTIONS} value={draft.direction} disabled={locked} onChange={pickDirection} />
          </View>
        ) : (
          <>
            {!ready && !error && <ActivityIndicator accessibilityLabel="Carregando dados" color={colors.primaryStrong} />}
            {editing ? renderEdit() : renderStep()}

            {error ? (
              <Text accessibilityRole="alert" className="rounded-xl bg-danger-soft p-4 text-danger">
                {error}
              </Text>
            ) : null}
            {attempt?.uncertain && (
              <Pressable accessibilityRole="button" accessibilityLabel={retry} disabled={busy} onPress={submit} className="min-h-12 items-center justify-center rounded-xl border border-outline">
                <Text className="font-bold text-primary">{retry}</Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>

      {!blocked && (
        <View className="absolute bottom-0 left-0 right-0 border-t border-outline/60 bg-canvas px-5 pb-8 pt-3.5">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action}
            disabled={busy}
            onPress={editing || step === 3 ? submit : advance}
            className={`h-[54px] items-center justify-center rounded-2xl bg-primary ${busy ? "opacity-50" : ""}`}
          >
            {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-sans text-[15.5px] font-bold text-on-primary">{action}</Text>}
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

      {sheet === "repeat" && (
        <BottomSheet title="Repetição" onClose={() => setSheet(null)}>
          {frozen && <Text className="rounded-2xl bg-primary-soft/50 p-4 text-sm text-primary-strong">{FROZEN_NOTE}</Text>}
          <RepeatFields draft={draft} today={today} locked={locked} scheduled={scheduled} dueLocked={dueLocked} onChange={update} />
        </BottomSheet>
      )}

      {sheet === "split" && (
        <BottomSheet
          title={seating ? SEAT_LABELS[draft.direction] : "Divisão"}
          trailing={!seating && totalCents > 0 ? <Text className="font-sans text-[13px] font-bold text-success">fecha {money(totalCents)}</Text> : undefined}
          onClose={() => setSheet(null)}
        >
          {renderSplit(true)}
        </BottomSheet>
      )}

      {sheet === "reminders" && (
        <BottomSheet title="Lembretes" onClose={() => setSheet(null)}>
          {renderReminders()}
        </BottomSheet>
      )}

      {sheet === "pix" && (
        <BottomSheet title={pixTitle} doneLabel="" onClose={() => setSheet(null)}>
          {renderPix()}
        </BottomSheet>
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
