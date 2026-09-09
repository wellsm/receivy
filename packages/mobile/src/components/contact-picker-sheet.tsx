import type { Person } from "@receivy/common";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { peopleClient } from "@/people/client";
import { initialOf } from "./contact-carousel";
import { MUTED_TINT } from "./tab-bar";

type ContactPickerSheetProps = {
  selected: string[];
  people?: Pick<typeof peopleClient, "list">;
  onToggle: (personId: string) => void;
  /** Every contact the sheet has shown, so the form can name the ones it selected. */
  onSeen: (people: Person[]) => void;
  onClose: () => void;
};

const LOAD_ERROR = "Não foi possível carregar os contatos.";

/** The whole agenda in a sheet: server-side search plus cursor paging, multi selection. */
export function ContactPickerSheet({ selected, people = peopleClient, onToggle, onSeen, onClose }: ContactPickerSheetProps) {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    (after?: string) =>
      people
        .list(false, after, search || undefined)
        .then((page) => {
          setFound((previous) => (after ? [...previous, ...page.people.filter((person) => !previous.some((known) => known.id === person.id))] : page.people));
          setCursor(page.nextCursor);
          setError("");
          onSeen(page.people);
        })
        .catch(() => setError(LOAD_ERROR))
        .finally(() => setLoading(false)),
    [people, search, onSeen],
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
      <View className="flex-1 justify-end bg-black/40">
        <View className="max-h-[85%] gap-3 rounded-t-3xl bg-canvas p-5">
          <Text accessibilityRole="header" className="text-xl font-extrabold text-primary-strong">
            Contatos
          </Text>
          <TextInput
            accessibilityLabel="Buscar contatos"
            placeholder="Buscar contatos…"
            placeholderTextColor={MUTED_TINT}
            maxLength={254}
            autoCorrect={false}
            value={term}
            onChangeText={(value) => {
              setLoading(true);
              setTerm(value);
            }}
            className="min-h-12 rounded-xl border border-outline bg-surface px-4 text-ink"
          />

          {error ? (
            <Text accessibilityRole="alert" className="rounded-xl bg-red-50 p-4 text-red-700">
              {error}
            </Text>
          ) : null}
          {loading && <ActivityIndicator accessibilityLabel="Carregando contatos" />}
          {!loading && !error && !found.length && <Text className="py-6 text-muted">Nenhum contato encontrado.</Text>}

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-2">
            {found.map((person) => (
              <Pressable
                key={person.id}
                accessibilityRole="checkbox"
                accessibilityLabel={person.name}
                accessibilityState={{ checked: selected.includes(person.id) }}
                onPress={() => onToggle(person.id)}
                className={`min-h-14 flex-row items-center gap-3 rounded-2xl border px-4 ${
                  selected.includes(person.id) ? "border-primary bg-primary-soft" : "border-outline bg-surface"
                }`}
              >
                <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-soft">
                  <Text className="font-extrabold text-primary-strong">{initialOf(person.name)}</Text>
                </View>
                <Text className="flex-1 font-semibold text-ink">{person.name}</Text>
                {selected.includes(person.id) && <Text className="font-bold text-primary">✓</Text>}
              </Pressable>
            ))}
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
            <Text className="font-bold text-white">Concluir</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
