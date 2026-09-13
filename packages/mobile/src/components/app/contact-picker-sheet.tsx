import type { Contact } from "@receivy/common";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { contactsClient } from "@/contacts/client";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { useThemeColors } from "@/theme/colors";

type ContactPickerSheetProps = {
  /** User ids: a billing seats the account behind the agenda entry, so two agendas agree on who is who. */
  selected: string[];
  contacts?: Pick<typeof contactsClient, "list">;
  onToggle: (userId: string) => void;
  /** Every contact the sheet has shown, so the form can name the ones it selected. */
  onSeen: (contacts: Contact[]) => void;
  onClose: () => void;
  /** Absent when the screen cannot navigate to the contact form. */
  onNew?: () => void;
};

const LOAD_ERROR = "Não foi possível carregar os contatos.";

/** The whole agenda in a sheet: server-side search plus cursor paging, multi selection. */
export function ContactPickerSheet({ selected, contacts = contactsClient, onToggle, onSeen, onClose, onNew }: ContactPickerSheetProps) {
  const colors = useThemeColors();
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<Contact[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    (after?: string) =>
      contacts
        .list(false, after, search || undefined)
        .then((page) => {
          setFound((previous) => (after ? [...previous, ...page.contacts.filter((contact) => !previous.some((known) => known.id === contact.id))] : page.contacts));
          setCursor(page.nextCursor);
          setError("");
          onSeen(page.contacts);
        })
        .catch(() => setError(LOAD_ERROR))
        .finally(() => setLoading(false)),
    [contacts, search, onSeen],
  );

  useEffect(() => {
    const timer = setTimeout(() => setSearch(term.trim()), 250);

    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-scrim">
        <View className="max-h-[85%] gap-3 rounded-t-3xl bg-canvas p-5">
          <Text accessibilityRole="header" className="text-xl font-extrabold text-primary-strong">
            Contatos
          </Text>
          <TextInput
            accessibilityLabel="Buscar contatos"
            placeholder="Buscar contatos…"
            placeholderTextColor={colors.muted}
            maxLength={254}
            autoCorrect={false}
            value={term}
            onChangeText={(value) => {
              setLoading(true);
              setTerm(value);
            }}
            className="min-h-12 rounded-xl border border-outline bg-surface px-4 text-ink"
          />
          {onNew && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Novo contato"
              onPress={onNew}
              className="min-h-12 flex-row items-center justify-center gap-2 rounded-xl border border-dashed border-primary"
            >
              <Text className="font-bold text-primary">+ Novo contato</Text>
            </Pressable>
          )}

          {error ? (
            <Text accessibilityRole="alert" className="rounded-xl bg-danger-soft p-4 text-danger">
              {error}
            </Text>
          ) : null}
          {loading && <ActivityIndicator accessibilityLabel="Carregando contatos" />}
          {!loading && !error && !found.length && <Text className="py-6 text-muted">Nenhum contato encontrado.</Text>}

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-2">
            {found.map((contact) => {
              const checked = selected.includes(contact.userId);

              return (
                <Pressable
                  key={contact.id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={contact.displayName}
                  accessibilityState={{ checked }}
                  onPress={() => onToggle(contact.userId)}
                  className={`min-h-14 flex-row items-center gap-3 rounded-2xl border px-4 ${checked ? "border-primary bg-primary-soft" : "border-outline bg-surface"}`}
                >
                  <InitialsAvatar name={contact.displayName} size={36} />
                  <Text className="flex-1 font-semibold text-ink">{contact.displayName}</Text>
                  {checked && <Text className="font-bold text-primary">✓</Text>}
                </Pressable>
              );
            })}
          </ScrollView>

          {cursor && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Carregar mais"
              disabled={loading}
              onPress={() => {
                setLoading(true);
                void load(cursor);
              }}
              className="min-h-12 items-center justify-center rounded-xl border border-outline"
            >
              <Text className="font-bold text-primary">Carregar mais</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Concluir"
            onPress={onClose}
            className="min-h-14 items-center justify-center rounded-2xl bg-primary"
          >
            <Text className="font-bold text-on-primary">Concluir</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
