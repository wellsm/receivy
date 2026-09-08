import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { formatMoney, type BillingDetail, type BillingsPage } from "@receivy/common";
import { SafeAreaView } from "@/components/safe-area-view";
import { financialClient, type FinancialClient } from "@/financial/client";
import { BillingFormScreen } from "./billing-form-screen";

type Client = Pick<FinancialClient, "billings" | "billing" | "patchBilling" | "paymentMethods" | "profile" | "createBilling">;

type BillingsScreenProps = {
  client?: Client;
  onBack?: () => void;
  onCreate?: () => void;
  onOpenCharge?: (id: string) => void;
};

const stateLabel = { active: "Ativa", paused: "Pausada", ended: "Encerrada" } as const;
const typeLabel = { once: "Uma vez", until: "Até uma data", indefinite: "Sem fim" } as const;

function Button({ label, onPress, disabled = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-12 items-center justify-center rounded-xl border border-primary px-4 py-3 ${primary ? "bg-primary" : "bg-surface"} ${disabled ? "opacity-40" : ""}`}
    >
      <Text className={`font-bold ${primary ? "text-white" : "text-primary"}`}>{label}</Text>
    </Pressable>
  );
}

function dateText(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export function BillingsScreen({ client = financialClient, onBack, onCreate, onOpenCharge }: BillingsScreenProps) {
  const [page, setPage] = useState<BillingsPage | null>(null);
  const [selected, setSelected] = useState<BillingDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(cursor?: string) {
    setError("");

    try {
      const next = await client.billings(cursor ? `cursor=${encodeURIComponent(cursor)}` : "");
      setPage((old) => (cursor && old ? { ...next, billings: [...old.billings, ...next.billings] } : next));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar suas cobranças.");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load intentionally sets state once mounted
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  async function open(id: string) {
    setError("");

    try {
      setSelected(await client.billing(id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível abrir a cobrança.");
    }
  }

  async function transition(state: "active" | "paused" | "ended") {
    if (!selected) return;

    setBusy(true);
    setError("");

    try {
      setSelected(await client.patchBilling(selected.id, { state }));
      setConfirm(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar a cobrança.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <BillingFormScreen
        client={client}
        billing={selected}
        onSaved={(saved) => {
          setSelected(saved);
          setEditing(false);
          void load();
        }}
        onBack={() => setEditing(false)}
      />
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas">
      <ScrollView contentContainerClassName="gap-5 p-5 pb-20">
        {selected ? (
          <>
            <Button label="Todas as cobranças" onPress={() => { setSelected(null); setConfirm(false); }} />
            <Text className="text-3xl font-bold text-primary-strong">{selected.description}</Text>
            <Text className="text-muted">{typeLabel[selected.type]} · {stateLabel[selected.state]}</Text>
            <Text className="text-3xl font-extrabold text-ink">{formatMoney(selected.total)} por cobrança</Text>
            {selected.state !== "ended" && (
              <View className="gap-2">
                <Button label="Editar" disabled={busy} onPress={() => setEditing(true)} />
                {selected.type === "indefinite" && (
                  <Button label={selected.state === "active" ? "Pausar" : "Reativar"} disabled={busy} onPress={() => void transition(selected.state === "active" ? "paused" : "active")} />
                )}
                <Button label="Encerrar" disabled={busy} onPress={() => setConfirm(true)} />
              </View>
            )}
            {confirm && (
              <View className="gap-3 rounded-xl border border-outline p-4">
                <Text>Encerrar cancela as cobranças pendentes e impede novas ocorrências. Esta ação não pode ser desfeita.</Text>
                <Button label="Confirmar encerramento" primary disabled={busy} onPress={() => void transition("ended")} />
                <Button label="Voltar" onPress={() => setConfirm(false)} />
              </View>
            )}
            <Text className="text-2xl font-bold text-primary-strong">Cobranças geradas</Text>
            {!selected.charges.length && <Text className="text-muted">Nenhuma cobrança gerada ainda.</Text>}
            {selected.charges.map((charge) => (
              <Pressable key={charge.id} accessibilityRole="button" accessibilityLabel={`Abrir cobrança de ${charge.recipient.name}`} onPress={() => onOpenCharge?.(charge.id)} className="gap-1 rounded-2xl border border-outline bg-surface p-4">
                <Text className="font-bold text-ink">{charge.recipient.name} · {formatMoney(charge.amount)}</Text>
                <Text className="text-sm text-muted">
                  {dateText(charge.dueDate)} · {charge.state === "pending" ? "Pendente" : charge.state === "paid" ? "Pago" : "Cancelado"}
                  {charge.installmentCount && charge.installmentCount > 1 ? ` · ${charge.installment}/${charge.installmentCount}` : ""}
                </Text>
              </Pressable>
            ))}
            {selected.type === "indefinite" && (
              <>
                <Text className="text-2xl font-bold text-primary-strong">Próximas ocorrências</Text>
                <Text className="text-muted">Ainda não são cobranças. Projeções não entram no saldo nem permitem pagamento, comprovante ou link.</Text>
                {selected.previews.map((p) => <Text key={p.occurrenceDate}>{dateText(p.occurrenceDate)} · {formatMoney(p.amount)}</Text>)}
              </>
            )}
          </>
        ) : (
          <>
            <Button label="Timeline" onPress={() => onBack?.()} />
            <Text className="text-4xl font-extrabold text-primary-strong">Cobranças</Text>
            <Text className="text-muted">Uma linha por cobrança configurada. A timeline mostra cada pessoa e vencimento.</Text>
            <Button label="Nova cobrança" primary onPress={() => onCreate?.()} />
            {!page && !error && <ActivityIndicator accessibilityLabel="Carregando cobranças" />}
            {page && !page.billings.length && <Text>Nenhuma cobrança ainda. Crie a primeira para acompanhar os vencimentos.</Text>}
            {page?.billings.map((billing) => (
              <View key={billing.id} className="gap-2 border-l-2 border-primary py-4 pl-4">
                <Text className="text-xl font-bold text-primary-strong">{billing.description}</Text>
                <Text>{typeLabel[billing.type]} · {stateLabel[billing.state]} · {formatMoney(billing.total)}</Text>
                {billing.nextDueDate && <Text className="text-sm text-muted">Próxima: {dateText(billing.nextDueDate)}</Text>}
                <Button label={`Abrir ${billing.description}`} onPress={() => void open(billing.id)} />
              </View>
            ))}
            {page?.nextCursor && <Button label="Carregar mais" onPress={() => void load(page.nextCursor ?? undefined)} />}
          </>
        )}
        {error ? (
          <>
            <Text accessibilityRole="alert" className="text-red-700">{error}</Text>
            <Button label="Tentar novamente" onPress={() => void load()} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
