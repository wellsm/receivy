import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "@/components/safe-area-view";
import { normalizePerson, type Person } from "@receivy/common";
import { peopleClient } from "@/people/client";

type Props = { onBack: () => void; onOpenLedger?: (id: string) => void; client?: typeof peopleClient };

export function PeopleScreen({ onBack, onOpenLedger, client = peopleClient }: Props) {
  const [people, setPeople] = useState<Person[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const version = useRef(0);
  const scroll = useRef<ScrollView>(null);
  const load = useCallback((after?: string) => {
    const current = ++version.current;
    return client.list(archived, after, search).then(result => {
      if (version.current !== current) return;
      setPeople(previous => after ? [...previous, ...result.people] : result.people);
      setCursor(result.nextCursor); setError("");
    }).catch(reason => { if (version.current === current) setError((reason as Error).message); })
      .finally(() => { if (version.current === current) setLoading(false); });
  }, [archived, client, search]);
  const invalidate = useCallback(() => { version.current++; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);

  function reset() { setEditing(null); setName(""); setEmail(""); setPhone(""); }
  async function save() {
    let input;
    try { input = normalizePerson({ name, email, phone }); }
    catch (reason) { setError((reason as Error).message); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await client.save(input, editing?.id);
      reset(); setNotice("Contato salvo."); await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  function archive(person: Person) {
    Alert.alert(`Arquivar ${person.name}?`, "O histórico será preservado.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Arquivar", onPress: () => {
        setBusy(true); setError("");
        void client.archive(person.id).then(async () => {
          if (editing?.id === person.id) reset();
          setNotice("Contato arquivado."); await load();
        }).catch(reason => setError(reason.message)).finally(() => setBusy(false));
      } },
    ]);
  }
  return <SafeAreaView className="flex-1 bg-canvas">
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerClassName="px-5 pb-12 pt-2">
        <Pressable accessibilityRole="button" onPress={onBack} className="min-h-12 justify-center"><Text className="font-bold text-primary">← Timeline</Text></Pressable>
        <Text className="mt-5 text-xs font-bold uppercase tracking-widest text-primary">Sua agenda</Text>
        <Text className="mt-3 text-3xl font-extrabold leading-9 text-primary-strong">Quem faz parte das suas contas?</Text>
        <Text className="mt-3 text-sm leading-6 text-muted">Cadastre pessoas para organizar cobranças. Elas não precisam ter uma conta no Receivy.</Text>
        <View className="my-6 gap-3 rounded-3xl border border-outline bg-surface p-5">
          <Text className="text-xl font-bold text-primary-strong">{editing ? "Editar contato" : "Novo contato"}</Text>
          <Text className="font-semibold text-ink">Nome</Text>
          <TextInput accessibilityLabel="Nome" autoComplete="name" autoCorrect={false} textContentType="name" maxLength={120} value={name} onChangeText={setName} className="min-h-12 rounded-xl border border-outline px-3 text-ink" />
          <Text className="font-semibold text-ink">E-mail (opcional)</Text>
          <TextInput accessibilityLabel="E-mail do contato" autoComplete="email" autoCorrect={false} textContentType="emailAddress" maxLength={254} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" className="min-h-12 rounded-xl border border-outline px-3 text-ink" />
          <Text className="font-semibold text-ink">Telefone com DDD (opcional)</Text>
          <TextInput accessibilityLabel="Telefone com DDD" maxLength={40} value={phone} onChangeText={setPhone} keyboardType="phone-pad" className="min-h-12 rounded-xl border border-outline px-3 text-ink" />
          <Pressable accessibilityRole="button" accessibilityLabel="Salvar contato" disabled={busy} onPress={() => void save()} className="mt-2 min-h-12 items-center justify-center rounded-xl bg-primary p-3">
            {busy ? <ActivityIndicator color="white" /> : <Text className="font-bold text-white">Salvar contato</Text>}
          </Pressable>
          {editing && <Pressable accessibilityRole="button" disabled={busy} onPress={reset} className="min-h-12 items-center justify-center"><Text className="text-primary">Cancelar edição</Text></Pressable>}
        </View>
        {error ? <Text accessibilityRole="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-red-700">{error}</Text> : null}
        {notice ? <Text accessibilityRole="alert" className="mb-4 text-primary">{notice}</Text> : null}
        <Text className="font-semibold text-ink">Buscar contatos</Text><TextInput accessibilityLabel="Buscar contatos" maxLength={254} value={search} onChangeText={value => { setLoading(true); setPeople([]); setCursor(null); setSearch(value); }} className="my-3 min-h-12 rounded-xl border border-outline px-3 text-ink" />
        <View className="flex-row items-center justify-between"><Text className="text-xl font-bold text-primary-strong">Contatos</Text><View className="flex-row items-center gap-2"><Text className="text-sm text-muted">Arquivados</Text><Switch accessibilityLabel="Ver arquivados" disabled={busy || loading} value={archived} onValueChange={value => { setLoading(true); setPeople([]); setCursor(null); setArchived(value); reset(); }} /></View></View>
        {loading && <ActivityIndicator accessibilityLabel="Carregando contatos" className="my-4" />}
        {!loading && !error && !people.length && <Text className="py-8 text-base leading-6 text-muted">{archived ? "Nenhum contato arquivado." : "Sua agenda começa com uma pessoa. Preencha o formulário acima."}</Text>}
        {people.map(person => <View key={person.id} className="gap-2 border-b border-outline py-5">
          <Text className="text-lg font-bold text-ink">{person.name}</Text><Text className="text-sm text-muted">{person.hasAccount ? "Com conta" : "Sem conta"}</Text><Text className="text-sm text-muted">{person.email ?? "Sem e-mail"}</Text>{person.phone && <Text className="text-sm text-muted">{person.phone}</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel={`Ver histórico de ${person.name}`} onPress={() => onOpenLedger?.(person.id)} className="min-h-12 justify-center"><Text className="font-semibold text-primary">Ver saldo e histórico</Text></Pressable>
          {!person.archivedAt && <View className="flex-row gap-4">
            <Pressable accessibilityRole="button" accessibilityLabel={`Editar ${person.name}`} disabled={busy} className="min-h-12 justify-center" onPress={() => { setEditing(person); setName(person.name); setEmail(person.email ?? ""); setPhone(person.phone ?? ""); scroll.current?.scrollTo({ y: 0, animated: true }); }}><Text className="font-semibold text-primary">Editar</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Arquivar ${person.name}`} disabled={busy} onPress={() => archive(person)} className="min-h-12 justify-center"><Text className="text-muted">Arquivar</Text></Pressable>
          </View>}
        </View>)}
        {(cursor || error) && <Pressable accessibilityRole="button" disabled={busy || loading} onPress={() => { setLoading(true); void load(error ? undefined : cursor ?? undefined); }} className="min-h-12 items-center justify-center"><Text className="text-primary">{error ? "Tentar carregar novamente" : "Carregar mais contatos"}</Text></Pressable>}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
