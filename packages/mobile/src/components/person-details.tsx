import { formatPhoneBR, type Person } from "@receivy/common";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { peopleClient } from "@/people/client";

type PersonDetailsProps = {
  person: Person;
  changed: () => Promise<void>;
  /** Absent when the screen cannot navigate to the contact form. */
  onEdit?: () => void;
  onNewCharge?: () => void;
};

const ARCHIVE_ERROR = "Não foi possível arquivar o contato.";

/** The contact header of the ledger: who this is, how to reach them and what can be done. */
export function PersonDetails({ person, changed, onEdit, onNewCharge }: PersonDetailsProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function archive() {
    setBusy(true);
    setMessage("");

    try {
      await peopleClient.archive(person.id);
      await changed();
      setMessage("Contato arquivado; histórico preservado.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : ARCHIVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function confirmArchive() {
    Alert.alert("Arquivar contato?", "O histórico será preservado.", [
      { text: "Voltar", style: "cancel" },
      { text: "Arquivar", style: "destructive", onPress: () => void archive() },
    ]);
  }

  return (
    <View className="gap-3 rounded-3xl border border-outline bg-surface p-5">
      <Text className="text-3xl font-extrabold text-primary-strong">{person.displayName}</Text>

      {person.nickname ? <Text className="text-sm text-muted">{person.name}</Text> : null}

      {person.phone ? <Text className="text-sm text-muted">{formatPhoneBR(person.phone)}</Text> : null}

      {person.email ? <Text className="text-sm text-muted">{person.email}</Text> : null}

      <Text className="text-xs text-muted">
        {person.hasAccount ? "Com conta" : "Sem conta"}
        {person.archivedAt ? " · Arquivado" : ""}
      </Text>

      {person.archivedAt ? null : (
        <View className="flex-row flex-wrap gap-4">
          {onEdit ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Editar" onPress={onEdit} className="min-h-12 justify-center">
              <Text className="font-bold text-primary">Editar</Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Arquivar contato"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={confirmArchive}
            className="min-h-12 justify-center"
          >
            <Text className="text-red-700">Arquivar contato</Text>
          </Pressable>

          {onNewCharge ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Nova cobrança" onPress={onNewCharge} className="min-h-12 justify-center">
              <Text className="font-bold text-primary">Nova cobrança</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {message ? (
        <Text accessibilityRole="alert" className="text-sm text-muted">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
