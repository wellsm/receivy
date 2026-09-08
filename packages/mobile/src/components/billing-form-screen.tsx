import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import * as Crypto from "expo-crypto";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  buildBillingInput,
  calendarDate,
  DEFAULT_BILLING_REMINDERS,
  formatMoney,
  resolveBillingSplit,
  type BillingDetail,
  type BillingFrequency,
  type BillingInput,
  type BillingType,
  type PaymentMethod,
  type Person,
  type ReminderDraft,
  type SplitMode,
} from "@receivy/common";
import { SafeAreaView } from "@/components/safe-area-view";
import { FinancialRequestError, financialClient, type FinancialClient } from "@/financial/client";
import { peopleClient } from "@/people/client";

type Client = Pick<FinancialClient, "paymentMethods" | "profile" | "createBilling" | "patchBilling">;

type Attempt = { input: BillingInput; key: string; uncertain: boolean };

type BillingFormScreenProps = {
  client?: Client;
  people?: Pick<typeof peopleClient, "list">;
  billing?: BillingDetail | null;
  onSaved: (billing: BillingDetail) => void;
  onBack: () => void;
};

const TYPES: { value: BillingType; label: string; hint: string }[] = [
  { value: "once", label: "Uma vez", hint: "Uma cobrança por pessoa." },
  { value: "until", label: "Até uma data", hint: "Repete até a data ou N vezes." },
  { value: "indefinite", label: "Sem fim", hint: "Repete até você encerrar." },
];

const FIELD = "min-h-12 rounded-xl border border-outline bg-canvas px-3 text-ink";

function moneyText(amountCents: number): string {
  return formatMoney({ amountCents, currency: "BRL" }).replace(/[^\d,]/g, "");
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3 rounded-3xl border border-outline bg-surface p-5">
      <Text className="text-xl font-bold text-primary-strong">{title}</Text>
      {children}
    </View>
  );
}

function Chip({ label, active, disabled, onPress, role = "button" }: { label: string; active: boolean; disabled: boolean; onPress: () => void; role?: "button" | "radio" | "checkbox" }) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ disabled, ...(role === "radio" ? { selected: active } : role === "checkbox" ? { checked: active } : {}) }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-12 justify-center rounded-full border px-4 ${active ? "border-primary bg-primary-soft" : "border-outline bg-surface"}`}
    >
      <Text className="font-semibold text-primary-strong">{label}</Text>
    </Pressable>
  );
}

export function BillingFormScreen({ client = financialClient, people = peopleClient, billing = null, onSaved, onBack }: BillingFormScreenProps) {
  const [contacts, setContacts] = useState<Person[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [type, setType] = useState<BillingType>(billing?.type ?? "once");
  const [selected, setSelected] = useState<string[]>(billing?.split.parts.flatMap((p) => (p.kind === "person" ? [p.personId] : [])) ?? []);
  const [owner, setOwner] = useState(billing ? billing.split.parts.some((p) => p.kind === "owner") || billing.split.mode === "fixed" : true);
  const [amount, setAmount] = useState(billing ? moneyText(billing.total.amountCents) : "");
  const [description, setDescription] = useState(billing?.description ?? "");
  const [frequency, setFrequency] = useState<BillingFrequency>(billing?.frequency ?? "monthly");
  const [start, setStart] = useState(billing?.startDate ?? calendarDate());
  const [end, setEnd] = useState(billing?.endDate ?? "");
  const [occurrences, setOccurrences] = useState("");
  const [timezone, setTimezone] = useState(billing?.timezone ?? "America/Sao_Paulo");
  const [pix, setPix] = useState(billing?.paymentMethodId ?? "");
  const [mode, setMode] = useState<SplitMode>(billing?.split.mode ?? "equal");
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      billing?.split.parts.map((p) => [
        p.kind === "owner" ? "owner" : p.personId,
        "amountCents" in p ? moneyText(p.amountCents) : "basisPoints" in p ? String(p.basisPoints / 100).replace(".", ",") : "",
      ]) ?? [],
    ),
  );
  const [reminders, setReminders] = useState<ReminderDraft[]>(
    (billing?.reminders ?? DEFAULT_BILLING_REMINDERS).map((r) => ({ ...r, offsetDays: String(r.offsetDays) })),
  );
  const [review, setReview] = useState<BillingInput | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const editing = Boolean(billing);
  const locked = Boolean(attempt);
  const frozen = editing && billing?.type !== "indefinite";
  const disabled = locked || !ready;

  useEffect(() => {
    void Promise.all([
      people.list(false).then((page) => {
        setContacts(page.people);
        setCursor(page.nextCursor);
      }),
      client.paymentMethods().then((page) => {
        setMethods(page.paymentMethods);
        if (!billing) setPix(page.paymentMethods.find((m) => m.isDefault)?.id ?? "");
      }),
      billing
        ? Promise.resolve()
        : client.profile().then(({ user }) => {
            setTimezone(user.timezone);
            setStart(calendarDate(new Date(), user.timezone));
          }),
    ])
      .then(() => setReady(true))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar os dados."));
  }, [billing, client, people]);

  function change<T>(setter: (value: T) => void) {
    return (value: T) => {
      if (locked) return;
      setter(value);
      setReview(null);
    };
  }

  async function loadMore() {
    if (!cursor) return;

    try {
      const page = await people.list(false, cursor);
      setContacts((old) => [...old, ...page.people.filter((p) => !old.some((a) => a.id === p.id))]);
      setCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar contatos.");
    }
  }

  function prepare() {
    setError("");

    try {
      setReview(buildBillingInput({ type, selected, owner, amount, description, frequency, start, end, occurrences, timezone, pix, mode, values, reminders }));
    } catch (reason) {
      setReview(null);
      setError(reason instanceof Error ? reason.message : "Confira os dados informados.");
    }
  }

  async function save(retry = attempt) {
    if (!review && !retry) return;

    const sent = retry ?? { input: review!, key: Crypto.randomUUID(), uncertain: false };
    setAttempt(sent);
    setBusy(true);
    setError("");

    try {
      const saved = billing
        ? await client.patchBilling(billing.id, {
            description: sent.input.description,
            totalCents: sent.input.totalCents,
            split: sent.input.split,
            paymentMethodId: sent.input.paymentMethodId,
            clearPaymentMethod: !sent.input.paymentMethodId,
            reminders: sent.input.reminders,
          })
        : await client.createBilling(sent.input, sent.key);
      setAttempt(null);
      onSaved(saved);
    } catch (reason) {
      const uncertain = sent.uncertain || !(reason instanceof FinancialRequestError) || reason.status >= 500;
      setAttempt(uncertain ? { ...sent, uncertain: true } : null);
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar a cobrança.");
    } finally {
      setBusy(false);
    }
  }

  function field(label: string, value: string, setter: (value: string) => void, options: { numeric?: boolean; placeholder?: string; editable?: boolean } = {}) {
    return (
      <View className="gap-2">
        <Text className="font-semibold text-ink">{label}</Text>
        <TextInput
          accessibilityLabel={label}
          editable={options.editable ?? !disabled}
          value={value}
          placeholder={options.placeholder}
          placeholderTextColor="#7D8794"
          onChangeText={change(setter)}
          inputMode={options.numeric ? "decimal" : "text"}
          className={FIELD}
        />
      </View>
    );
  }

  const selectable = [...contacts, ...selected.filter((id) => !contacts.some((p) => p.id === id)).map((id, i) => ({ id, name: `Contato indisponível ${i + 1}` }))];
  const nameOf = (id: string) => (id === "owner" ? "Minha parte" : (contacts.find((p) => p.id === id)?.name ?? "Contato indisponível"));
  const allocations = review ? resolveBillingSplit(review.totalCents, review.split) : [];

  return (
    <SafeAreaView className="flex-1 bg-canvas">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 px-5 pb-14 pt-2">
        <Pressable accessibilityRole="button" disabled={locked} onPress={onBack} className="min-h-12 justify-center">
          <Text className="font-bold text-primary">← Voltar</Text>
        </Pressable>
        <Text className="text-4xl font-extrabold leading-10 text-primary-strong">Divida com clareza antes de cobrar.</Text>
        <Text className="leading-6 text-muted">{editing ? "Edições valem só para ocorrências ainda não geradas." : "Seu rascunho permanece se a rede falhar."}</Text>
        {!ready && !error && <ActivityIndicator accessibilityLabel="Carregando dados" />}

        <Section title="Como cobrar">
          <View accessibilityRole="radiogroup" className="gap-2">
            {TYPES.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: type === option.value, disabled: disabled || editing }}
                disabled={disabled || editing}
                onPress={() => change(setType)(option.value)}
                className={`gap-1 rounded-2xl border p-4 ${type === option.value ? "border-primary bg-primary-soft" : "border-outline"}`}
              >
                <Text className="font-bold text-primary-strong">{option.label}</Text>
                <Text className="text-sm text-muted">{option.hint}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title="Pessoas">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
            {selectable.map((person) => (
              <Chip
                key={person.id}
                role="checkbox"
                label={person.name}
                active={selected.includes(person.id)}
                disabled={disabled || frozen}
                onPress={() => change(setSelected)(selected.includes(person.id) ? selected.filter((id) => id !== person.id) : [...selected, person.id])}
              />
            ))}
          </ScrollView>
          {cursor && (
            <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void loadMore()} className="min-h-12 justify-center">
              <Text className="font-bold text-primary">Carregar mais contatos</Text>
            </Pressable>
          )}
          <Chip role="checkbox" label="Incluir minha parte" active={owner} disabled={disabled || frozen} onPress={() => change(setOwner)(!owner)} />
        </Section>

        <Section title="Valor e rateio">
          {field("Valor de cada cobrança", amount, setAmount, { numeric: true, placeholder: "0,00", editable: !disabled && !frozen })}
          {field("Descrição", description, setDescription, { placeholder: "Opcional", editable: !disabled && !frozen })}
          <View className="flex-row flex-wrap gap-2">
            {(["equal", "fixed", "percentage"] as const).map((value, index) => (
              <Chip key={value} label={["Partes iguais", "Valores fixos", "Percentuais"][index]!} active={mode === value} disabled={disabled || frozen} onPress={() => change(setMode)(value)} />
            ))}
          </View>
          {mode !== "equal" &&
            [...selected, ...(owner && mode === "percentage" ? ["owner"] : [])].map((id) => (
              <View key={id}>
                {field(`${mode === "fixed" ? "Valor" : "Percentual"} de ${nameOf(id)}`, values[id] ?? "", (v) => setValues({ ...values, [id]: v }), { numeric: true, editable: !disabled && !frozen })}
              </View>
            ))}
        </Section>

        <Section title="Quando">
          {field(type === "once" ? "Vencimento" : "Primeiro vencimento", start, setStart, { placeholder: "AAAA-MM-DD", editable: !disabled && !editing })}
          {type !== "once" && (
            <View className="flex-row gap-2">
              <Chip label="Mensal" active={frequency === "monthly"} disabled={disabled || editing} onPress={() => change(setFrequency)("monthly")} />
              <Chip label="Anual" active={frequency === "yearly"} disabled={disabled || editing} onPress={() => change(setFrequency)("yearly")} />
            </View>
          )}
          {type === "until" && field("Quantas vezes", occurrences, setOccurrences, { numeric: true, placeholder: "ex.: 3", editable: !disabled && !editing })}
          {type === "until" && field("Ou até a data", end, setEnd, { placeholder: "AAAA-MM-DD", editable: !disabled && !editing })}
          {type !== "once" && <Text className="text-sm text-muted">Dias inexistentes usam o último dia do mês.</Text>}
          {field("Fuso horário IANA", timezone, setTimezone, { editable: !disabled && !editing })}
        </Section>

        <Section title="Pix e lembretes">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
            <Chip label="Chave principal" active={!pix} disabled={disabled} onPress={() => change(setPix)("")} />
            {methods.map((m) => <Chip key={m.id} label={m.label || m.pixKey} active={pix === m.id} disabled={disabled} onPress={() => change(setPix)(m.id)} />)}
          </ScrollView>
          {reminders.map((r, index) => (
            <View key={index} className="gap-2">
              <Chip role="checkbox" label={`Lembrete ${index + 1}`} active={r.enabled} disabled={disabled} onPress={() => change(setReminders)(reminders.map((a, i) => (i === index ? { ...a, enabled: !a.enabled } : a)))} />
              {field(`Dias do lembrete ${index + 1}`, r.offsetDays, (v) => setReminders(reminders.map((a, i) => (i === index ? { ...a, offsetDays: v } : a))))}
            </View>
          ))}
          <Chip label="Adicionar lembrete" active={false} disabled={disabled || reminders.length >= 10} onPress={() => change(setReminders)([...reminders, { offsetDays: "", enabled: true }])} />
        </Section>

        <Pressable accessibilityRole="button" accessibilityLabel="Revisar cobrança" disabled={disabled} onPress={prepare} className="min-h-14 items-center justify-center rounded-2xl bg-primary disabled:opacity-50">
          <Text className="font-bold text-white">Revisar cobrança</Text>
        </Pressable>

        {review && (
          <View className="gap-3 rounded-3xl border border-primary bg-surface p-5">
            <Text className="text-xl font-bold text-primary-strong">Revisão exata</Text>
            <Text className="text-3xl font-extrabold text-ink">{formatMoney({ amountCents: review.totalCents, currency: "BRL" })} por cobrança</Text>
            {allocations.map((a) => (
              <Text key={a.kind === "owner" ? "owner" : a.personId} className="font-bold text-ink">
                {nameOf(a.kind === "owner" ? "owner" : a.personId)}: {formatMoney({ amountCents: a.amountCents, currency: "BRL" })}
              </Text>
            ))}
            <Pressable accessibilityRole="button" accessibilityLabel={editing ? "Salvar cobrança" : "Criar cobrança"} disabled={busy || locked} onPress={() => void save(null)} className="min-h-14 items-center justify-center rounded-2xl bg-primary">
              {busy ? <ActivityIndicator color="white" /> : <Text className="font-bold text-white">{editing ? "Salvar cobrança" : "Criar cobrança"}</Text>}
            </Pressable>
          </View>
        )}
        {error ? <Text accessibilityRole="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</Text> : null}
        {attempt?.uncertain && (
          <Pressable accessibilityRole="button" accessibilityLabel={editing ? "Tentar salvar novamente" : "Tentar criar novamente"} disabled={busy} onPress={() => void save()} className="min-h-12 items-center justify-center rounded-xl border border-outline">
            <Text className="font-bold text-primary">{editing ? "Tentar salvar novamente" : "Tentar criar novamente"}</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
