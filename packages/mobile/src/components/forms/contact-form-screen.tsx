import { normalizeContact, type Contact, type ContactInput } from "@receivy/common";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { patchDraft } from "@/financial/draft-store";
import { contactsClient, ContactsRequestError } from "@/contacts/client";
import { useThemeColors } from "@/theme/colors";

type ContactFormClient = Pick<typeof contactsClient, "get" | "save">;

type ContactFormScreenProps = {
  /** Absent on `/contacts/new`: the screen creates instead of editing. */
  contactId?: string;
  client?: ContactFormClient;
  /** `new-billing` when the billing form sent the user here. */
  returnTo?: string;
  onSaved?: (contact: Contact) => void;
};

const INTRO = "Adicione pessoas para dividir despesas e lembrar pagamentos sem constrangimento.";
const EMAIL_NOTE = "Sem e-mail, a pessoa só recebe pelo link compartilhado. Quando ela entrar por um convite, você confirma quem é.";
const LINKED_NOTE = "Contato vinculado a uma conta: só o apelido pode mudar.";
const TAKEN_NOTE = "Esse e-mail já pertence a outra conta ou contato.";
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

/**
 * The endpoint answers `409` for a duplicate e-mail, for an edit that touches
 * more than the nickname of an active contact and for an e-mail that already
 * belongs to another account, and the client cannot tell them apart — the
 * envelope carries the stable `CONFLICT` code for all. The screen can: only an
 * active contact provokes the second one, only an edit the third.
 */
function saveError(reason: unknown, linked: boolean, editing: boolean): string {
  if (reason instanceof ContactsRequestError && reason.status === 409) {
    if (linked) {
      return LINKED_NOTE;
    }

    if (editing) {
      return TAKEN_NOTE;
    }
  }

  if (reason instanceof Error) {
    return reason.message;
  }

  return SAVE_ERROR;
}

/** The contact form on its own screen: create from `/contacts/new`, edit from `/contacts/[id]/edit`. */
export function ContactFormScreen({ contactId, client = contactsClient, returnTo, onSaved }: ContactFormScreenProps) {
  const colors = useThemeColors();
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!contactId) {
      return;
    }

    let live = true;

    void client
      .get(contactId)
      .then((contact) => {
        if (!live) {
          return;
        }

        setName(contact.name);
        setNickname(contact.nickname ?? "");
        setEmail(contact.email);
        // Once the person signed in, name and e-mail are theirs; only the nickname stays with the owner.
        setLinked(contact.status === "active");
      })
      .catch((reason: unknown) => {
        if (live) {
          setError(reason instanceof Error ? reason.message : LOAD_ERROR);
        }
      });

    return () => {
      live = false;
    };
  }, [client, contactId]);

  async function save() {
    setError("");

    let input: ContactInput;

    try {
      input = normalizeContact({ name, nickname, email });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : INVALID_ERROR);
      return;
    }

    setBusy(true);

    try {
      const saved = await client.save(input, contactId);

      // Came from the billing form: hand the contact back to the parked draft,
      // which seats people by the account behind the agenda entry.
      if (returnTo === "new-billing") {
        patchDraft({ selected: [saved.userId] });
      }

      onSaved?.(saved);
    } catch (reason) {
      setError(saveError(reason, linked, Boolean(contactId)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 pb-8 pt-3" showsVerticalScrollIndicator={false}>
        <Text className="leading-6 text-muted">{INTRO}</Text>

        {linked ? <Text className="rounded-xl bg-warning-soft p-4 text-sm font-semibold text-warning">{LINKED_NOTE}</Text> : null}

        <View className="gap-4 rounded-3xl border border-outline/40 bg-surface p-5">
          <Field label="Nome completo">
            <TextInput
              accessibilityLabel="Nome completo"
              accessibilityState={{ disabled: linked }}
              placeholder="Maria Silva"
              placeholderTextColor={colors.muted}
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
              placeholderTextColor={colors.muted}
              maxLength={60}
              value={nickname}
              onChangeText={setNickname}
              className={FIELD_CLASS}
            />
          </Field>

          <Field label="E-mail (opcional)" hint={EMAIL_NOTE}>
            <TextInput
              accessibilityLabel="E-mail"
              accessibilityState={{ disabled: linked }}
              placeholder="contato@email.com"
              placeholderTextColor={colors.muted}
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
          <Text accessibilityRole="alert" className="rounded-xl bg-danger-soft p-4 text-danger">
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
          {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-bold text-on-primary">Salvar contato</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
