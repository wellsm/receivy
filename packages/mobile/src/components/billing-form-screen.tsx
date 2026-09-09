import {
  addCalendarDays,
  BILLING_CATEGORIES,
  billingSummaryLine,
  buildBillingInput,
  calendarDate,
  draftTotalCents,
  EMPTY_BILLING_DRAFT,
  formatMoney,
  previewBillingSplit,
  splitParties,
  splitPartyKey,
  type BillingDetail,
  type BillingDraft,
  type BillingInput,
  type BillingType,
  type PaymentMethod,
  type Person,
  type SplitMode,
  type SplitParty,
} from "@receivy/common";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "@/components/safe-area-view";
import { financialClient, FinancialRequestError, type FinancialClient } from "@/financial/client";
import { clearDraft, saveDraft, takeDraft } from "@/financial/draft-store";
import { peopleClient } from "@/people/client";
import { ContactCarousel } from "./contact-carousel";
import { ContactPickerSheet } from "./contact-picker-sheet";
import { SplitEditor, type SplitRow } from "./split-editor";
import { ACTIVE_TINT, MUTED_TINT } from "./tab-bar";

type Client = Pick<FinancialClient, "paymentMethods" | "profile" | "createBilling" | "patchBilling">;
type Attempt = { input: BillingInput; key: string; uncertain: boolean };

type BillingFormScreenProps = {
  client?: Client;
  people?: Pick<typeof peopleClient, "list">;
  billing?: BillingDetail | null;
  onSaved: (billing: BillingDetail) => void;
  onBack: () => void;
  /** Absent when the screen cannot navigate to the contact form. */
  onCreateContact?: () => void;
  /** Absent when the screen cannot navigate to the Pix keys. */
  onCreatePix?: () => void;
};

const FROZEN_NOTE = "Cobranças já geradas só permitem categoria, Pix e lembretes.";
const LOAD_ERROR = "Não foi possível carregar os dados.";

const TYPES: { value: BillingType; label: string }[] = [
  { value: "once", label: "À vista" },
  { value: "until", label: "Parcelado" },
  { value: "indefinite", label: "Sem fim" },
];

const AMOUNT_LABELS: Record<BillingType, string> = {
  once: "Valor",
  until: "Valor por parcela",
  indefinite: "Valor por ocorrência",
};

const SPLIT_MODES: { value: SplitMode; label: string }[] = [
  { value: "equal", label: "Igual" },
  { value: "shares", label: "Cotas" },
  { value: "fixed", label: "Valor fixo" },
  { value: "percentage", label: "Porcentagem" },
];

const QUICK_DUE: { label: string; days: number }[] = [
  { label: "Hoje", days: 0 },
  { label: "Amanhã", days: 1 },
  { label: "Em 7 dias", days: 7 },
];

const QUICK_AMOUNTS: { cents: number; label: string }[] = [
  { cents: 1_000, label: "+ R$ 10" },
  { cents: 5_000, label: "+ R$ 50" },
  { cents: 10_000, label: "+ R$ 100" },
];

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

function todayIn(timezone: string): string {
  try {
    return calendarDate(new Date(), timezone);
  } catch {
    return calendarDate();
  }
}

function daysUntil(date: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return null;
  }

  const [year, month, day] = date.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);

  return Math.round((Date.UTC(year!, month! - 1, day!) - Date.UTC(todayYear!, todayMonth! - 1, todayDay!)) / 86_400_000);
}

function dueText(start: string, today: string): string {
  const diff = daysUntil(start, today);

  if (diff === null) {
    return "Sem data";
  }

  if (diff === 0) {
    return "Hoje";
  }

  if (diff === 1) {
    return "Amanhã";
  }

  if (diff > 1 && diff <= 60) {
    return `em ${diff} dias`;
  }

  return `${start.slice(8, 10)}/${start.slice(5, 7)}`;
}

function draftFromBilling(billing: BillingDetail): BillingDraft {
  const parts = billing.split.parts;

  return {
    type: billing.type,
    selected: parts.flatMap((part) => (part.kind === "person" ? [part.personId] : [])),
    owner: parts.some((part) => part.kind === "owner") || billing.split.mode === "fixed",
    amount: moneyText(billing.total.amountCents),
    description: billing.description,
    frequency: billing.frequency ?? "monthly",
    start: billing.startDate,
    end: billing.endDate ?? "",
    occurrences: "",
    timezone: billing.timezone,
    pix: billing.paymentMethodId ?? "",
    mode: billing.split.mode,
    values: Object.fromEntries(
      parts.map((part) => [
        part.kind === "owner" ? "owner" : part.personId,
        "amountCents" in part
          ? moneyText(part.amountCents)
          : "basisPoints" in part
            ? String(part.basisPoints / 100).replace(".", ",")
            : "shares" in part
              ? String(part.shares)
              : "",
      ]),
    ),
    category: billing.category,
    reminders: billing.reminders.map((reminder) => ({ ...reminder, offsetDays: String(reminder.offsetDays) })),
  };
}

function unknownPerson(id: string): Person {
  return { id, name: "Contato", email: null, phone: null, archivedAt: null, createdAt: "", hasAccount: false, lastBilledAt: null };
}

function abbreviate(pixKey: string): string {
  return pixKey.length <= 18 ? pixKey : `${pixKey.slice(0, 7)}…${pixKey.slice(-7)}`;
}

function Step({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <View className="gap-3 rounded-3xl border border-outline bg-surface p-4">
      <View className="flex-row items-center gap-2">
        <View className="h-6 w-6 items-center justify-center rounded-full bg-primary-soft">
          <Text className="text-xs font-extrabold text-primary-strong">{index}</Text>
        </View>
        <Text className="text-lg font-extrabold text-primary-strong">{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Chip({ label, active, disabled, onPress }: { label: string; active: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-11 justify-center rounded-full border px-4 ${active ? "border-primary bg-primary-soft" : "border-outline bg-canvas"} ${disabled ? "opacity-50" : ""}`}
    >
      <Text className={`text-sm font-bold ${active ? "text-primary-strong" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}

export function BillingFormScreen({ client = financialClient, people = peopleClient, billing = null, onSaved, onBack, onCreateContact, onCreatePix }: BillingFormScreenProps) {
  const [draft, setDraft] = useState<BillingDraft>(() =>
    billing ? draftFromBilling(billing) : EMPTY_BILLING_DRAFT("America/Sao_Paulo", calendarDate()),
  );
  const [recent, setRecent] = useState<Person[]>([]);
  const [directory, setDirectory] = useState<Person[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [picker, setPicker] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);

  const editing = Boolean(billing);
  const locked = Boolean(attempt);
  const frozen = editing && billing?.type !== "indefinite";
  // `BillingPatch` carries no type, frequency or dates, so the schedule is
  // read-only in every edit — otherwise Salvar would silently drop the change.
  const scheduled = editing;

  const load = useCallback(
    (stored: BillingDraft | null) => {
      let live = true;

      void Promise.all([
        people.list(false, undefined, undefined, "recent"),
        client.paymentMethods(),
        billing || stored ? Promise.resolve(null) : client.profile(),
      ])
        .then(([agenda, wallet, me]) => {
          if (!live) {
            return;
          }

          const active = wallet.paymentMethods.filter((method) => !method.archivedAt);

          setRecent(agenda.people.slice(0, 12));
          setDirectory(agenda.people);
          setMethods(active);
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
    [billing, client, people],
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

  function update(patch: Partial<BillingDraft>) {
    if (locked) {
      return;
    }

    setError("");
    setDraft((current) => ({ ...current, ...patch }));
  }

  function toggle(personId: string) {
    update({ selected: draft.selected.includes(personId) ? draft.selected.filter((id) => id !== personId) : [...draft.selected, personId] });
  }

  const remember = useCallback((seen: Person[]) => {
    setDirectory((current) => [...current, ...seen.filter((person) => !current.some((known) => known.id === person.id))]);
  }, []);

  function leaveTo(go: () => void) {
    saveDraft(draft);
    go();
  }

  function addAmount(cents: number) {
    update({ amount: moneyText(draftTotalCents(draft) + cents) });
  }

  function patchBody(input: BillingInput) {
    const editable = {
      paymentMethodId: input.paymentMethodId,
      clearPaymentMethod: !input.paymentMethodId,
      reminders: input.reminders,
      category: input.category,
    };

    if (billing && billing.type !== "indefinite") {
      return editable;
    }

    return { description: input.description, totalCents: input.totalCents, split: input.split, ...editable };
  }

  async function save(sent: Attempt) {
    setAttempt(sent);
    setBusy(true);
    setError("");

    try {
      const saved = billing ? await client.patchBilling(billing.id, patchBody(sent.input)) : await client.createBilling(sent.input, sent.key);

      setAttempt(null);
      clearDraft();
      onSaved(saved);
    } catch (reason) {
      const uncertain = sent.uncertain || !(reason instanceof FinancialRequestError) || reason.status >= 500;

      setAttempt(uncertain ? { ...sent, uncertain: true } : null);
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar a cobrança.");
    } finally {
      setBusy(false);
    }
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
      void save({ input: buildBillingInput(draft), key: Crypto.randomUUID(), uncertain: false });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Confira os dados informados.");
    }
  }

  const today = todayIn(draft.timezone);
  const totalCents = draftTotalCents(draft);
  const { amounts, error: hint } = previewBillingSplit(draft);
  const carousel = [
    ...recent,
    ...draft.selected.filter((id) => !recent.some((person) => person.id === id)).map((id) => directory.find((person) => person.id === id) ?? unknownPerson(id)),
  ];

  function nameOf(key: string): string {
    return key === "owner" ? "Eu" : (directory.find((person) => person.id === key)?.name ?? "Contato");
  }

  const rowParties: SplitParty[] = draft.mode === "fixed" ? draft.selected.map((personId) => ({ kind: "person", personId })) : splitParties(draft);
  const rows: SplitRow[] = rowParties.map((party) => {
    const key = splitPartyKey(party);
    const cents = amounts[key];
    const amount = cents === undefined ? "" : money(cents);
    const shares = draft.values[key] || "1";

    return {
      key,
      name: nameOf(key),
      value: draft.values[key] ?? "",
      amountText: draft.mode === "shares" && amount ? `${shares} cota${shares === "1" ? "" : "s"} · ${amount}` : amount,
    };
  });

  const participants = draft.selected.length + (draft.owner ? 1 : 0);
  const perPerson = draft.mode === "equal" ? (Object.values(amounts)[0] ?? 0) : totalCents;
  const summary =
    participants && totalCents
      ? billingSummaryLine({ people: participants, amountCents: perPerson, mode: draft.mode, dueLabel: dueText(draft.start, today) })
      : "Escolha os contatos e informe o valor.";
  const action = editing ? "Salvar" : "Criar cobrança";
  const retry = editing ? "Tentar salvar novamente" : "Tentar criar novamente";

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
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
          {editing ? "Editar cobrança" : "Nova cobrança"}
        </Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 pb-40 pt-2" showsVerticalScrollIndicator={false}>
        {frozen && <Text className="rounded-2xl bg-primary-soft/50 p-4 text-sm text-primary-strong">{FROZEN_NOTE}</Text>}
        {!ready && !error && <ActivityIndicator accessibilityLabel="Carregando dados" color={ACTIVE_TINT} />}

        <Step index={1} title="Para quem?">
          <ContactCarousel
            people={carousel}
            selected={draft.selected}
            today={today}
            disabled={locked || frozen}
            onToggle={toggle}
            onNew={editing || !onCreateContact ? undefined : () => leaveTo(onCreateContact)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ver todos"
            disabled={locked || frozen}
            onPress={() => setPicker(true)}
            className="min-h-11 items-center justify-center rounded-xl border border-outline"
          >
            <Text className="font-bold text-primary">Ver todos</Text>
          </Pressable>
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-ink">Eu também participo</Text>
            <Switch
              accessibilityLabel="Eu também participo"
              disabled={locked || frozen}
              value={draft.owner}
              onValueChange={(value) => update({ owner: value })}
            />
          </View>
        </Step>

        <Step index={2} title="Qual o valor?">
          {draft.type !== "once" && <Text className="font-semibold text-ink">{AMOUNT_LABELS[draft.type]}</Text>}
          <View className="flex-row items-center gap-2 rounded-2xl border border-outline bg-canvas px-4">
            <Text className="text-xl font-extrabold text-muted">R$</Text>
            <TextInput
              accessibilityLabel="Valor"
              editable={!locked && !frozen}
              inputMode="decimal"
              placeholder="0,00"
              placeholderTextColor={MUTED_TINT}
              value={draft.amount}
              onChangeText={(value) => update({ amount: value })}
              className="min-h-14 flex-1 text-2xl font-extrabold text-ink"
            />
          </View>
          <View className="flex-row flex-wrap gap-2">
            {QUICK_AMOUNTS.map((option) => (
              <Chip key={option.cents} label={option.label} active={false} disabled={locked || frozen} onPress={() => addAmount(option.cents)} />
            ))}
          </View>
        </Step>

        <Step index={3} title="Descrição">
          <TextInput
            accessibilityLabel="Descrição"
            editable={!locked && !frozen}
            maxLength={500}
            placeholder="Ex.: mercado do mês"
            placeholderTextColor={MUTED_TINT}
            value={draft.description}
            onChangeText={(value) => update({ description: value })}
            className="min-h-12 rounded-xl border border-outline bg-canvas px-3 text-ink"
          />
          <View className="flex-row flex-wrap gap-2">
            {BILLING_CATEGORIES.map((category) => (
              <Chip
                key={category.value}
                label={category.label}
                active={draft.category === category.value}
                disabled={locked}
                onPress={() => update({ category: category.value, description: draft.description || category.label })}
              />
            ))}
          </View>
        </Step>

        <Step index={4} title="Modalidade">
          <View className="flex-row flex-wrap gap-2">
            {TYPES.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                active={draft.type === option.value}
                disabled={locked || scheduled}
                onPress={() => update({ type: option.value, frequency: option.value === "until" ? "monthly" : draft.frequency, end: "" })}
              />
            ))}
          </View>
          {draft.type === "until" && (
            <View className="gap-2">
              <Text className="font-semibold text-ink">Parcelas</Text>
              <TextInput
                accessibilityLabel="Parcelas"
                editable={!locked && !scheduled}
                inputMode="numeric"
                placeholder="2 a 120"
                placeholderTextColor={MUTED_TINT}
                value={draft.occurrences}
                onChangeText={(value) => update({ occurrences: value })}
                className="min-h-12 rounded-xl border border-outline bg-canvas px-3 text-ink"
              />
            </View>
          )}
          {draft.type === "indefinite" && (
            <View className="flex-row gap-2">
              <Chip label="Mensal" active={draft.frequency === "monthly"} disabled={locked || scheduled} onPress={() => update({ frequency: "monthly" })} />
              <Chip label="Anual" active={draft.frequency === "yearly"} disabled={locked || scheduled} onPress={() => update({ frequency: "yearly" })} />
            </View>
          )}
        </Step>

        <Step index={5} title="Divisão">
          <View className="flex-row flex-wrap gap-2">
            {SPLIT_MODES.map((option) => (
              <Chip key={option.value} label={option.label} active={draft.mode === option.value} disabled={locked || frozen} onPress={() => update({ mode: option.value })} />
            ))}
          </View>
          <SplitEditor
            mode={draft.mode}
            rows={rows}
            hint={hint ?? ""}
            disabled={locked || frozen}
            onChange={(key, value) => update({ values: { ...draft.values, [key]: value } })}
          />
        </Step>

        <Step index={6} title="Vencimento">
          <View className="flex-row flex-wrap gap-2">
            {QUICK_DUE.map((option) => (
              <Chip
                key={option.label}
                label={option.label}
                active={draft.start === addCalendarDays(today, option.days)}
                disabled={locked || scheduled}
                onPress={() => update({ start: addCalendarDays(today, option.days) })}
              />
            ))}
          </View>
          <TextInput
            accessibilityLabel="Vencimento"
            editable={!locked && !scheduled}
            placeholder="AAAA-MM-DD"
            placeholderTextColor={MUTED_TINT}
            value={draft.start}
            onChangeText={(value) => update({ start: value })}
            className="min-h-12 rounded-xl border border-outline bg-canvas px-3 text-ink"
          />
          <Text className="text-sm text-muted">Lembrete no vencimento.</Text>
        </Step>

        <Step index={7} title="Pix">
          <View className="flex-row flex-wrap gap-2">
            {methods.map((method) => (
              <Chip
                key={method.id}
                label={`${method.label || method.pixKeyType.toUpperCase()} · ${abbreviate(method.pixKey)}`}
                active={draft.pix === method.id}
                disabled={locked}
                onPress={() => update({ pix: method.id })}
              />
            ))}
            <Chip label="Nenhuma" active={!draft.pix} disabled={locked} onPress={() => update({ pix: "" })} />
            {!editing && onCreatePix && <Chip label="Cadastrar chave" active={false} disabled={locked} onPress={() => leaveTo(onCreatePix)} />}
          </View>
        </Step>

        {/* Reminders stay out of the seven quick steps: a new billing takes the
            default policy, and only an edit is allowed to fine-tune it. */}
        {editing && (
          <Step index={8} title="Lembretes">
            {draft.reminders.map((reminder, index) => (
              <View key={index} className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Text className="font-semibold text-ink">Lembrete {index + 1}</Text>
                  <Switch
                    accessibilityLabel={`Lembrete ${index + 1}`}
                    disabled={locked}
                    value={reminder.enabled}
                    onValueChange={(value) =>
                      update({ reminders: draft.reminders.map((item, position) => (position === index ? { ...item, enabled: value } : item)) })
                    }
                  />
                </View>
                <TextInput
                  accessibilityLabel={`Dias do lembrete ${index + 1}`}
                  editable={!locked}
                  placeholder="0 no vencimento, -3 antes"
                  placeholderTextColor={MUTED_TINT}
                  value={reminder.offsetDays}
                  onChangeText={(value) =>
                    update({ reminders: draft.reminders.map((item, position) => (position === index ? { ...item, offsetDays: value } : item)) })
                  }
                  className="min-h-12 rounded-xl border border-outline bg-canvas px-3 text-ink"
                />
              </View>
            ))}
            <Chip
              label="Adicionar lembrete"
              active={false}
              disabled={locked || draft.reminders.length >= 10}
              onPress={() => update({ reminders: [...draft.reminders, { offsetDays: "", enabled: true }] })}
            />
          </Step>
        )}

        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-red-50 p-4 text-red-700">
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
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 gap-2 border-t border-outline bg-surface px-5 pb-8 pt-3">
        <Text className="text-sm font-semibold text-muted">{summary}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action}
          disabled={busy}
          onPress={submit}
          className={`min-h-14 items-center justify-center rounded-2xl bg-primary ${busy ? "opacity-50" : ""}`}
        >
          {busy ? <ActivityIndicator color="white" /> : <Text className="font-bold text-white">{action}</Text>}
        </Pressable>
      </View>

      {picker && (
        <ContactPickerSheet selected={draft.selected} people={people} onToggle={toggle} onSeen={remember} onClose={() => setPicker(false)} />
      )}
    </SafeAreaView>
  );
}
