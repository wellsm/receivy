import { formatPhoneBR, normalizePerson, type Person, type PersonInput } from "@receivy/common";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "@/components/safe-area-view";
import { patchDraft } from "@/financial/draft-store";
import { peopleClient } from "@/people/client";
import { MUTED_TINT } from "./tab-bar";

type ContactFormClient = Pick<typeof peopleClient, "get" | "save">;

type ContactFormScreenProps = {
  /** Absent on `/people/new`: the screen creates instead of editing. */
  personId?: string;
  client?: ContactFormClient;
  /** `new-billing` when the billing form sent the user here. */
  returnTo?: string;
  onSaved?: (person: Person) => void;
};

const INTRO = "Adicione pessoas para dividir despesas e lembrar pagamentos sem constrangimento.";
const LINKED_NOTE = "Contato vinculado a uma conta: só o apelido pode mudar.";
const LOAD_ERROR = "Não foi possível carregar o contato.";
const SAVE_ERROR = "Não foi possível salvar o contato.";
const INVALID_ERROR = "Confira os dados do contato.";

const FIELD_CLASS = "min-h-12 rounded-xl border border-outline/60 bg-surface px-3 text-ink";
const FROZEN_CLASS = "min-h-12 rounded-xl border border-outline/40 bg-surface-muted px-3 text-muted";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-bold text-ink">{label}</Text>
      {children}
      {hint ? <Text className="text-xs text-muted">{hint}</Text> : null}
    </View>
  );
}

/** The contact form on its own screen: create from `/people/new`, edit from `/people/[id]/edit`. */
export function ContactFormScreen({ personId, client = peopleClient, returnTo, onSaved }: ContactFormScreenProps) {
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!personId) {
      return;
    }

    let live = true;

    void client
      .get(personId)
      .then((person) => {
        if (!live) {
          return;
        }

        setName(person.name);
        setNickname(person.nickname ?? "");
        setPhone(formatPhoneBR(person.phone ?? ""));
        setEmail(person.email ?? "");
        setLinked(person.hasAccount);
      })
      .catch((reason: unknown) => {
        if (live) {
          setError(reason instanceof Error ? reason.message : LOAD_ERROR);
        }
      });

    return () => {
      live = false;
    };
  }, [client, personId]);

  async function save() {
    setError("");

    let input: PersonInput;

    try {
      // `normalizePerson` takes the masked phone and hands back `+55…`, so the
      // field stays readable while the API keeps its canonical shape.
      input = normalizePerson({ name, nickname, email, phone });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : INVALID_ERROR);
      return;
    }

    setBusy(true);

    try {
      const saved = await client.save(input, personId);

      // Came from the billing form: hand the contact back to the parked draft.
      if (returnTo === "new-billing") {
        patchDraft({ selected: [saved.id] });
      }

      onSaved?.(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 pb-8 pt-3" showsVerticalScrollIndicator={false}>
        <Text className="leading-6 text-muted">{INTRO}</Text>

        {linked ? <Text className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">{LINKED_NOTE}</Text> : null}

        <View className="gap-4 rounded-3xl border border-outline/40 bg-surface p-5">
          <Field label="Nome completo">
            <TextInput
              accessibilityLabel="Nome completo"
              accessibilityState={{ disabled: linked }}
              placeholder="Maria Silva"
              placeholderTextColor={MUTED_TINT}
              maxLength={120}
              autoComplete="name"
              editable={!linked}
              value={name}
              onChangeText={setName}
              className={linked ? FROZEN_CLASS : FIELD_CLASS}
            />
          </Field>

          <Field label="Apelido">
            <TextInput
              accessibilityLabel="Apelido"
              placeholder="Como prefere chamar"
              placeholderTextColor={MUTED_TINT}
              maxLength={60}
              value={nickname}
              onChangeText={setNickname}
              className={FIELD_CLASS}
            />
          </Field>

          <Field label="WhatsApp / Celular" hint="Usado para lembretes.">
            <TextInput
              accessibilityLabel="WhatsApp / Celular"
              accessibilityState={{ disabled: linked }}
              placeholder="(11) 98765-4321"
              placeholderTextColor={MUTED_TINT}
              keyboardType="phone-pad"
              maxLength={20}
              editable={!linked}
              value={phone}
              onChangeText={(value) => setPhone(formatPhoneBR(value))}
              className={linked ? FROZEN_CLASS : FIELD_CLASS}
            />
          </Field>

          <Field label="E-mail" hint="Usado para enviar avisos.">
            <TextInput
              accessibilityLabel="E-mail"
              accessibilityState={{ disabled: linked }}
              placeholder="contato@email.com"
              placeholderTextColor={MUTED_TINT}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={254}
              editable={!linked}
              value={email}
              onChangeText={setEmail}
              className={linked ? FROZEN_CLASS : FIELD_CLASS}
            />
          </Field>
        </View>

        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-red-50 p-4 text-red-700">
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View className="border-t border-outline/40 bg-surface px-5 pb-6 pt-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Salvar contato"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void save()}
          className="min-h-12 items-center justify-center rounded-xl bg-primary"
        >
          {busy ? <ActivityIndicator color="#ffffff" /> : <Text className="font-bold text-white">Salvar contato</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
