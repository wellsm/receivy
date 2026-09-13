import { contactBadge, formatPhoneBR, initialsOf, BadgeTone, type Contact } from "@receivy/common";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { contactsClient } from "@/contacts/client";
import { useThemeColors } from "@/theme/colors";

type ContactsScreenProps = {
  client?: Pick<typeof contactsClient, "list">;
  onOpenLedger?: (id: string) => void;
  /** Absent when the screen cannot navigate to the contact form. */
  onNewContact?: () => void;
};

const LIST_ERROR = "Não foi possível carregar os contatos.";
const PENDING_LABEL = "Ainda não entrou";
const LINK_ONLY_LABEL = "Só por link";

const chevronMark = require("../../../assets/images/auth/chevron.svg");
const plusMark = require("../../../assets/images/auth/plus.svg");
const searchMark = require("../../../assets/images/auth/search.svg");

const BADGE_CLASS: Record<BadgeTone, string> = {
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
  success: "bg-primary-soft/50 text-primary-strong",
  neutral: "bg-surface-muted text-muted",
};

/** Phone first because it is what a reminder uses; the e-mail is the fallback line, and a person without one only gets the shared link. */
function subtitleOf(contact: Contact): string {
  if (contact.phone) {
    return formatPhoneBR(contact.phone);
  }

  if (!contact.email) {
    return LINK_ONLY_LABEL;
  }

  return contact.email;
}

function countLabel(total: number): string {
  return `${total} ${total === 1 ? "contato" : "contatos"}`;
}

function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  return <Text className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_CLASS[tone]}`}>{label}</Text>;
}

function ContactCard({ contact, onPress }: { contact: Contact; onPress: () => void }) {
  const colors = useThemeColors();
  const badge = contactBadge(contact.activeCharges);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Contato ${contact.displayName}`}
      onPress={onPress}
      className="min-h-16 flex-row items-center gap-3 rounded-2xl border border-outline/40 bg-surface p-4"
    >
      <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-soft">
        <Text className="text-sm font-extrabold text-primary-strong">{initialsOf(contact.displayName)}</Text>
      </View>

      <View className="flex-1 gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-base font-bold text-ink" numberOfLines={1}>
            {contact.displayName}
          </Text>

          {/* The person has not signed in yet: the agenda says so instead of pretending they get reminders. */}
          {contact.status === "pending" ? <Badge label={PENDING_LABEL} tone={BadgeTone.Neutral} /> : null}
          <Badge label={badge.label} tone={badge.tone} />
        </View>

        <Text className="text-xs text-muted" numberOfLines={1}>
          {subtitleOf(contact)}
        </Text>
      </View>

      <Image source={chevronMark} tintColor={colors.muted} style={{ width: 18, height: 18 }} />
    </Pressable>
  );
}

/** The agenda: server-side search, pending badges and a FAB towards the contact form. */
export function ContactsScreen({ client = contactsClient, onOpenLedger, onNewContact }: ContactsScreenProps) {
  const colors = useThemeColors();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Every request carries the version it was born with. A slower `Carregar mais`
  // must not append the previous query's page onto fresh search results, and a
  // blurred screen must not set state after its own reload was superseded.
  const version = useRef(0);

  const load = useCallback(
    (after?: string) => {
      const mine = ++version.current;

      return client
        .list(false, after, search || undefined)
        .then((page) => {
          if (mine !== version.current) {
            return;
          }

          setContacts((previous) => (after ? [...previous, ...page.contacts] : page.contacts));
          setCursor(page.nextCursor);
          setError("");
        })
        .catch((reason: unknown) => {
          if (mine !== version.current) {
            return;
          }

          setError(reason instanceof Error ? reason.message : LIST_ERROR);
        })
        .finally(() => {
          if (mine === version.current) {
            setLoading(false);
          }
        });
    },
    [client, search],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      // A new query starts a new page run: the old cursor belongs to the results
      // it is replacing.
      setCursor(null);
      setSearch(term.trim());
    }, 300);

    return () => clearTimeout(timer);
  }, [term]);

  const invalidate = useCallback(() => {
    version.current++;
  }, []);

  // The form lives on its own screen, so coming back has to show what it saved.
  useFocusEffect(
    useCallback(() => {
      void load();

      return invalidate;
    }, [load, invalidate]),
  );

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 pb-32 pt-3" showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center gap-2 rounded-2xl border border-outline/40 bg-surface px-4">
          <Image source={searchMark} tintColor={colors.muted} style={{ width: 16, height: 16 }} />

          <TextInput
            accessibilityLabel="Buscar contatos"
            placeholder="Buscar por nome ou e-mail..."
            placeholderTextColor={colors.muted}
            maxLength={254}
            autoCorrect={false}
            value={term}
            onChangeText={(value) => {
              setLoading(true);
              setTerm(value);
            }}
            className="min-h-12 flex-1 text-ink"
          />
        </View>

        <View className="flex-row items-center justify-between">
          <Text className="text-xs text-muted">{countLabel(contacts.length)}</Text>
        </View>

        {error ? (
          <View className="gap-2 rounded-2xl bg-danger-soft p-4">
            <Text accessibilityRole="alert" className="text-danger">
              {error}
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tentar novamente"
              onPress={() => {
                setLoading(true);
                void load();
              }}
              className="min-h-11 justify-center"
            >
              <Text className="font-bold text-primary">Tentar novamente</Text>
            </Pressable>
          </View>
        ) : null}

        {loading && !contacts.length ? <ActivityIndicator accessibilityLabel="Carregando contatos" color={colors.primaryStrong} /> : null}

        {!loading && !error && !contacts.length ? (
          <View className="items-center gap-2 rounded-3xl border border-outline/40 bg-surface p-8">
            <Text className="text-lg font-extrabold text-primary-strong">Nenhum contato ainda</Text>
            <Text className="text-center text-sm leading-5 text-muted">Cadastre alguém para dividir despesas e lembrar pagamentos.</Text>
          </View>
        ) : null}

        <View className="gap-2">
          {contacts.map((contact) => (
            <ContactCard key={contact.id} contact={contact} onPress={() => onOpenLedger?.(contact.id)} />
          ))}
        </View>

        {cursor ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Carregar mais"
            accessibilityState={{ disabled: loading }}
            disabled={loading}
            onPress={() => {
              setLoading(true);
              void load(cursor);
            }}
            className="min-h-12 items-center justify-center rounded-xl border border-outline"
          >
            <Text className="font-bold text-primary">Carregar mais</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {onNewContact ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Novo contato"
          onPress={onNewContact}
          className="absolute bottom-8 right-5 h-14 flex-row items-center gap-2 rounded-full bg-primary px-5"
        >
          <Image source={plusMark} tintColor={colors.onPrimary} style={{ width: 18, height: 18 }} />
          <Text className="font-bold text-on-primary">Novo contato</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}
