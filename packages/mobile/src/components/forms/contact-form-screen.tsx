import { normalizeContact, paymentMethodText, PaymentProvider, pixKeyField, PixKeyType, type Contact, type ContactInput, type ContactPaymentMethodInput, type PaymentMethod } from "@receivy/common";
import { Image } from "expo-image";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { PixKeyFields, PIX_TYPE_ICONS } from "@/components/app/pix-key-fields";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { financialClient, type FinancialClient } from "@/financial/client";
import { patchDraft } from "@/financial/draft-store";
import { contactsClient, ContactsRequestError } from "@/contacts/client";
import { useThemeColors } from "@/theme/colors";

type ContactFormClient = Pick<typeof contactsClient, "get" | "save">;
/** The keys filed under this contact live on the financial API, not on the contact itself. */
type ContactKeysClient = Pick<FinancialClient, "paymentMethods" | "defaultPaymentMethod" | "archivePaymentMethod">;

type ContactFormScreenProps = {
  /** Absent on `/contacts/new`: the screen creates instead of editing. */
  contactId?: string;
  client?: ContactFormClient;
  financial?: ContactKeysClient;
  /** `new-billing` when the billing form sent the user here. */
  returnTo?: string;
  onSaved?: (contact: Contact) => void;
};

const trashMark = require("../../../assets/images/auth/trash.svg");

function iconOf(method: PaymentMethod): number {
  return PIX_TYPE_ICONS[method.kind ?? PixKeyType.Random];
}

const INTRO = "Adicione pessoas para dividir despesas e lembrar pagamentos sem constrangimento.";
const EMAIL_NOTE = "Sem e-mail, a pessoa só recebe pelo link compartilhado. Quando ela entrar por um convite, você confirma quem é.";
const LINKED_NOTE = "Contato vinculado a uma conta: só o apelido pode mudar.";
const TAKEN_NOTE = "Esse e-mail já pertence a outra conta ou contato.";
const LOAD_ERROR = "Não foi possível carregar o contato.";
const SAVE_ERROR = "Não foi possível salvar o contato.";
const INVALID_ERROR = "Confira os dados do contato.";
const PIX_NOTE = "A chave que você usa para pagar esta pessoa. Ela entra como a chave padrão do contato.";
const KEYS_ERROR = "Não foi possível carregar as chaves Pix do contato.";
const KEYS_UPDATE_ERROR = "Não foi possível atualizar as chaves Pix do contato.";
const ARCHIVE_NOTE = "A chave sai das próximas contas a pagar deste contato. As contas já criadas não mudam.";

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
export function ContactFormScreen({ contactId, client = contactsClient, financial = financialClient, returnTo, onSaved }: ContactFormScreenProps) {
  const colors = useThemeColors();
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [linked, setLinked] = useState(false);
  const [pixType, setPixType] = useState<PixKeyType>(PixKeyType.Email);
  // The key as the person sees it: masked for the current type, canonicalized only on save.
  const [pixKey, setPixKey] = useState("");
  const [pixLabel, setPixLabel] = useState("");
  const [keys, setKeys] = useState<PaymentMethod[]>([]);
  const [archiving, setArchiving] = useState<PaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** `live` tells a late answer the screen it was meant for is gone, like the sibling effect below. */
  const loadKeys = useCallback(
    (live: () => boolean = () => true) => {
      if (!contactId) {
        return Promise.resolve();
      }

      return financial
        .paymentMethods(contactId)
        .then((page) => {
          if (live()) {
            setKeys(page.paymentMethods.filter((method) => !method.archivedAt));
          }
        })
        .catch((reason: unknown) => {
          if (live()) {
            setError(reason instanceof Error ? reason.message : KEYS_ERROR);
          }
        });
    },
    [contactId, financial],
  );

  useEffect(() => {
    let live = true;

    void loadKeys(() => live);

    return () => {
      live = false;
    };
  }, [loadKeys]);

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

  function pickPixType(type: PixKeyType) {
    setPixType(type);
    setPixKey("");
    setError("");
  }

  /** The typed key travels canonical (`+55…`, digits only); only the field keeps the mask. */
  function paymentMethodInput(): { paymentMethod?: ContactPaymentMethodInput } {
    const key = pixKeyField(pixType).unformat(pixKey);

    if (!key) {
      return {};
    }

    const label = pixLabel.trim();

    return { paymentMethod: { provider: PaymentProvider.Pix, kind: pixType, value: key, ...(label ? { label } : {}) } };
  }

  /**
   * The failure has to be readable, and the dialog covers the form's alert: a
   * refused action closes it and leaves the reason standing on the form, with the
   * key untouched. Only a change worth showing reloads the list.
   */
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");

    try {
      await action();
    } catch (reason) {
      setArchiving(null);
      setError(reason instanceof Error ? reason.message : KEYS_UPDATE_ERROR);
      setBusy(false);

      return;
    }

    setArchiving(null);

    await loadKeys();

    setBusy(false);
  }

  async function save() {
    setError("");

    let input: ContactInput;

    try {
      input = normalizeContact({ name, nickname, email, ...paymentMethodInput() });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : INVALID_ERROR);

      return;
    }

    setBusy(true);

    try {
      const saved = await client.save(input, contactId);

      // Came from the billing form: hand the contact back to the parked draft, which seats
      // participants by the account behind the agenda entry and the one who receives by the entry.
      // An edit changes nobody's seat: the form only went there to register a key.
      if (!contactId && returnTo === "new-billing") {
        patchDraft({ contact: { id: saved.id, userId: saved.userId } });
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
              accessibilityLabel="E-mail (opcional)"
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

        <View className="gap-4 rounded-3xl border border-outline/40 bg-surface p-5">
          <View className="gap-1">
            <Text className="text-sm font-bold text-ink">Chave Pix (opcional)</Text>
            <Text className="text-xs leading-5 text-muted">{PIX_NOTE}</Text>
          </View>

          {keys.map((method) => {
            const text = paymentMethodText(method);

            return (
              <View key={method.id} className="gap-3 rounded-2xl border border-outline/30 bg-surface-muted/60 p-3">
                <View className="flex-row items-center gap-3">
                  <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary-soft">
                    <Image source={iconOf(method)} tintColor={colors.primaryStrong} style={{ width: 18, height: 18 }} />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <View className="flex-row items-center gap-2">
                      <Text className="flex-shrink text-sm font-semibold text-ink" numberOfLines={1}>
                        {method.label || text.title}
                      </Text>
                      {method.isDefault ? <Text className="rounded-full bg-primary-soft/70 px-2 py-0.5 text-[11px] font-semibold text-primary-strong">Padrão</Text> : null}
                    </View>
                    <Text className="text-[11px] text-muted" numberOfLines={1}>
                      {text.value}
                    </Text>
                  </View>
                </View>

                <View className="flex-row gap-2">
                  {method.isDefault ? null : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Definir padrão"
                      accessibilityHint={`Usa a chave ${text.title} por padrão`}
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      onPress={() => void act(() => financial.defaultPaymentMethod(method.id))}
                      className="min-h-10 items-center justify-center rounded-lg border border-outline/40 px-3"
                    >
                      <Text className="text-xs font-semibold text-primary">Definir padrão</Text>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Arquivar"
                    accessibilityHint={`Arquiva a chave ${text.title}`}
                    accessibilityState={{ disabled: busy }}
                    disabled={busy}
                    onPress={() => setArchiving(method)}
                    className="min-h-10 items-center justify-center rounded-lg px-3"
                  >
                    <Text className="text-xs font-semibold text-danger">Arquivar</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}

          <PixKeyFields type={pixType} value={pixKey} disabled={busy} onPickType={pickPixType} onChangeKey={(raw) => setPixKey(pixKeyField(pixType).format(raw))} onClear={() => setPixKey("")} />

          <Field label="Rótulo da chave">
            <TextInput
              accessibilityLabel="Rótulo da chave"
              placeholder="Rótulo (opcional)"
              placeholderTextColor={colors.muted}
              maxLength={60}
              value={pixLabel}
              onChangeText={setPixLabel}
              className={FIELD_CLASS}
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

      {archiving && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setArchiving(null)}>
          <View className="flex-1 items-center justify-center bg-scrim px-4">
            <View className="w-full max-w-sm gap-4 rounded-2xl border border-outline/30 bg-surface p-5">
              <View className="flex-row items-center gap-3">
                <View className="h-11 w-11 items-center justify-center rounded-full bg-danger-soft">
                  <Image source={trashMark} tintColor={colors.danger} style={{ width: 22, height: 22 }} />
                </View>
                <View className="flex-1">
                  <Text accessibilityRole="header" className="text-[17px] font-bold text-ink">
                    Arquivar chave Pix?
                  </Text>
                  <Text className="text-[11px] text-muted">Esta ação não pode ser desfeita.</Text>
                </View>
              </View>
              <View className="gap-1 rounded-xl border border-outline/30 bg-surface-muted/70 p-3">
                <Text className="text-[11px] font-medium text-muted">{paymentMethodText(archiving).title}</Text>
                <Text className="text-sm font-bold text-ink">{paymentMethodText(archiving).value}</Text>
              </View>
              <Text className="text-xs leading-5 text-muted">{ARCHIVE_NOTE}</Text>
              <View className="flex-row gap-2.5 pt-1">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => setArchiving(null)}
                  className={`h-11 flex-1 items-center justify-center rounded-xl border border-outline/50 ${busy ? "opacity-50" : ""}`}
                >
                  <Text className="text-sm font-semibold text-ink">Cancelar</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Arquivar chave Pix"
                  accessibilityState={{ disabled: busy, busy }}
                  disabled={busy}
                  onPress={() => void act(() => financial.archivePaymentMethod(archiving.id))}
                  className={`h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-danger-solid ${busy ? "opacity-50" : ""}`}
                >
                  {busy ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Image source={trashMark} tintColor="white" style={{ width: 16, height: 16 }} />
                      <Text className="text-sm font-semibold text-on-danger">Arquivar</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}
