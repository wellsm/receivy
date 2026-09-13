import { useEffect, useState } from "react";
import Constants from "expo-constants";
import { Image } from "expo-image";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ACCOUNT_DELETED, ACCOUNT_DELETION_UNCONFIRMED, THEME_PREFERENCE_OPTIONS, type AuthUser } from "@receivy/common";
import { accountClient, type AccountClient } from "@/account/client";
import { profileStore, type ProfileStore } from "@/account/profile";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { useTabHeader } from "@/navigation/tab-header";
import { LegalSheet, type LegalKind } from "@/components/app/legal-sheet";
import { useThemeColors } from "@/theme/colors";
import { useThemePreference } from "@/theme/preference";

type ProfileScreenProps = {
  client?: Pick<AccountClient, "profile" | "save" | "logout" | "erase">;
  store?: Pick<ProfileStore, "remember">;
  version?: string;
  onOpenContacts?: () => void;
  onOpenPix?: () => void;
  onLoggedOut?: () => void;
};

type Dialog = "logout" | "delete" | null;

const ICONS = {
  check: require("../../../assets/images/auth/check.svg"),
  chevron: require("../../../assets/images/auth/chevron.svg"),
  edit: require("../../../assets/images/auth/edit.svg"),
  group: require("../../../assets/images/auth/group.svg"),
  key: require("../../../assets/images/auth/key.svg"),
  logout: require("../../../assets/images/auth/logout.svg"),
  mail: require("../../../assets/images/auth/mail.svg"),
  trash: require("../../../assets/images/auth/trash.svg"),
  warning: require("../../../assets/images/auth/warning.svg"),
} as const;

const FALLBACK_TIMEZONE = "America/Sao_Paulo";

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

type RowProps = {
  icon: keyof typeof ICONS;
  label: string;
  title: string;
  subtitle: string;
  danger?: boolean;
  disabled?: boolean;
  onPress?: () => void;
};

function Row({ icon, label, title, subtitle, danger = false, disabled = false, onPress }: RowProps) {
  const colors = useThemeColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className="min-h-14 flex-row items-center gap-3 px-4 py-3"
    >
      <View className={`h-10 w-10 items-center justify-center rounded-xl ${danger ? "bg-danger-soft" : "bg-surface-muted"}`}>
        <Image source={ICONS[icon]} tintColor={danger ? colors.danger : colors.primaryStrong} style={{ width: 20, height: 20 }} />
      </View>

      <View className="flex-1 gap-0.5">
        <Text className={`text-base font-bold ${danger ? "text-danger" : "text-ink"}`}>{title}</Text>
        <Text className="text-xs leading-4 text-muted">{subtitle}</Text>
      </View>

      <Image source={ICONS.chevron} tintColor={colors.muted} style={{ width: 18, height: 18 }} />
    </Pressable>
  );
}

export function ProfileScreen({
  client = accountClient,
  store = profileStore,
  version = Constants.expoConfig?.version ?? "1.0.0",
  onOpenContacts,
  onOpenPix,
  onLoggedOut,
}: ProfileScreenProps) {
  const colors = useThemeColors();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(false);
  const [legal, setLegal] = useState<LegalKind | null>(null);
  const [themePreference, chooseTheme] = useThemePreference();

  useEffect(() => {
    let active = true;

    void client.profile().then(
      (profile) => {
        if (!active) {
          return;
        }

        setUser(profile);
        setDraft(profile.name ?? "");
      },
      () => active && setNotice("Não foi possível carregar sua conta."),
    );

    return () => {
      active = false;
    };
  }, [client]);

  async function saveName() {
    const name = draft.trim();

    if (!name || busy) {
      return;
    }

    setBusy(true);

    try {
      const saved = await client.save({ name, locale: "pt-BR", country: "BR", timezone: deviceTimezone() });

      setUser(saved);
      setDraft(saved.name ?? "");
      setEditing(false);
      setNotice("");
      store.remember(saved);
    } catch {
      setNotice("Não foi possível salvar o nome.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (busy) {
      return;
    }

    setBusy(true);
    setDialog(null);

    try {
      await client.logout();
      setEnded(true);
      setNotice("");
      onLoggedOut?.();
    } catch {
      setNotice("Não foi possível sair. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    if (confirmation !== "EXCLUIR" || busy) {
      return;
    }

    setBusy(true);
    setDialog(null);
    let confirmed = false;

    try {
      // The client always clears the local session, so the screen is done either way.
      confirmed = await client.erase();
    } catch {
      confirmed = false;
    }

    setEnded(true);
    setNotice(confirmed ? ACCOUNT_DELETED : ACCOUNT_DELETION_UNCONFIRMED);
    setBusy(false);
    onLoggedOut?.();
  }

  function closeDialog() {
    setDialog(null);
    setConfirmation("");
  }

  const initial = (user?.name?.trim().charAt(0) || "R").toUpperCase();

  useTabHeader({ title: "Perfil" });

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View className="gap-5 px-5 pt-2">
          {notice ? (
            <Text accessibilityLiveRegion="polite" className="rounded-2xl bg-surface-muted p-4 leading-5 text-ink">
              {notice}
            </Text>
          ) : null}

          {!ended && user ? (
            <>
              <View className="items-center gap-3 rounded-3xl border border-outline/40 bg-surface p-6">
                <View className="h-24 w-24 items-center justify-center rounded-full bg-primary-soft">
                  <Text className="text-4xl font-extrabold text-primary-strong">{initial}</Text>
                </View>

                {editing ? (
                  <View className="w-full flex-row items-center gap-2">
                    <TextInput
                      accessibilityLabel="Nome"
                      value={draft}
                      maxLength={120}
                      onChangeText={setDraft}
                      className="min-h-12 flex-1 rounded-xl border border-outline bg-canvas px-3 text-ink"
                    />

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Salvar nome"
                      accessibilityState={{ disabled: busy || !draft.trim() }}
                      disabled={busy || !draft.trim()}
                      onPress={() => void saveName()}
                      className="h-12 w-12 items-center justify-center rounded-xl bg-primary"
                    >
                      <Image source={ICONS.check} tintColor={colors.onPrimary} style={{ width: 20, height: 20 }} />
                    </Pressable>
                  </View>
                ) : (
                  <View className="flex-row items-center gap-2">
                    <Text className="text-2xl font-extrabold text-ink">{user.name ?? "Sem nome"}</Text>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Editar nome"
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      onPress={() => {
                        setDraft(user.name ?? "");
                        setEditing(true);
                      }}
                      className="h-10 w-10 items-center justify-center rounded-full bg-surface-muted"
                    >
                      <Image source={ICONS.edit} tintColor={colors.primaryStrong} style={{ width: 18, height: 18 }} />
                    </Pressable>
                  </View>
                )}

                <View className="flex-row items-center gap-2">
                  <Image source={ICONS.mail} tintColor={colors.muted} style={{ width: 16, height: 16 }} />
                  <Text className="text-sm text-muted">{user.email}</Text>
                </View>
              </View>

              <View className="gap-2">
                <Text className="px-1 text-xs font-bold tracking-wider text-muted">GERENCIAMENTO</Text>

                <View className="overflow-hidden rounded-3xl border border-outline/40 bg-surface">
                  <Row
                    icon="group"
                    label="Gerenciar contatos"
                    title="Meus Contatos"
                    subtitle="Gerenciar pessoas e dados salvos de cobrança"
                    onPress={onOpenContacts}
                  />

                  <View className="mx-4 h-px bg-outline/40" />

                  <Row
                    icon="key"
                    label="Gerenciar chaves Pix"
                    title="Minhas Chaves Pix"
                    subtitle="Chaves cadastradas para receber pagamentos"
                    onPress={onOpenPix}
                  />
                </View>
              </View>

              <View className="gap-2">
                <Text className="px-1 text-xs font-bold tracking-wider text-muted">APARÊNCIA</Text>

                <View accessibilityRole="radiogroup" accessibilityLabel="Aparência" className="flex-row gap-2 rounded-3xl border border-outline/40 bg-surface p-2">
                  {THEME_PREFERENCE_OPTIONS.map((option) => {
                    const selected = option.value === themePreference;

                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityLabel={option.label}
                        accessibilityState={{ checked: selected }}
                        onPress={() => chooseTheme(option.value)}
                        className={`min-h-11 flex-1 items-center justify-center rounded-2xl ${selected ? "bg-primary-soft/60" : ""}`}
                      >
                        <Text className={`text-sm font-semibold ${selected ? "text-primary-strong" : "text-muted"}`}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View className="gap-2">
                <Text className="px-1 text-xs font-bold tracking-wider text-muted">SEGURANÇA E SESSÃO</Text>

                <View className="overflow-hidden rounded-3xl border border-outline/40 bg-surface">
                  <Row
                    icon="logout"
                    label="Sair da conta"
                    title="Sair da conta"
                    subtitle="Encerrar sessão ativa neste dispositivo"
                    disabled={busy}
                    onPress={() => setDialog("logout")}
                  />

                  <View className="mx-4 h-px bg-outline/40" />

                  <Row
                    icon="trash"
                    label="Excluir conta"
                    title="Excluir conta"
                    subtitle="Remover histórico, vínculos e dados permanentemente"
                    danger
                    disabled={busy}
                    onPress={() => {
                      setConfirmation("");
                      setDialog("delete");
                    }}
                  />
                </View>
              </View>
            </>
          ) : null}

          <View className="items-center gap-1 pt-2">

            <View className="flex-row items-center gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Termos"
                onPress={() => setLegal("terms")}
                className="min-h-12 justify-center"
              >
                <Text className="font-bold text-primary">Termos</Text>
              </Pressable>

              <Text className="text-muted">·</Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Privacidade"
                onPress={() => setLegal("privacy")}
                className="min-h-12 justify-center"
              >
                <Text className="font-bold text-primary">Privacidade</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      <LegalSheet kind={legal} onClose={() => setLegal(null)} />

      {dialog === "logout" ? (
        <Modal transparent animationType="fade" visible onRequestClose={closeDialog}>
          <View className="flex-1 items-center justify-center bg-scrim px-6">
            <View className="w-full gap-4 rounded-3xl bg-surface p-6">
              <Text accessibilityRole="header" className="text-xl font-extrabold text-ink">
                Deseja sair da sua conta?
              </Text>

              <Text className="leading-5 text-muted">Encerrar sessão ativa neste dispositivo.</Text>

              <View className="flex-row gap-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar"
                  onPress={closeDialog}
                  className="min-h-12 flex-1 items-center justify-center rounded-xl border border-outline"
                >
                  <Text className="font-bold text-primary">Cancelar</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Sair"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => void logout()}
                  className="min-h-12 flex-1 items-center justify-center rounded-xl bg-primary"
                >
                  <Text className="font-bold text-on-primary">Sair</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}

      {dialog === "delete" ? (
        <Modal transparent animationType="fade" visible onRequestClose={closeDialog}>
          <View className="flex-1 items-center justify-center bg-scrim px-6">
            <View className="w-full gap-4 rounded-3xl bg-surface p-6">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-danger-soft">
                <Image source={ICONS.warning} tintColor={colors.danger} style={{ width: 24, height: 24 }} />
              </View>

              <Text accessibilityRole="header" className="text-xl font-extrabold text-ink">
                Excluir conta?
              </Text>

              <Text className="leading-5 text-muted">
                Esta ação é irreversível. Suas cobranças, contatos e chaves Pix serão apagados. Registros compartilhados
                podem ser preservados com referências anonimizadas.
              </Text>

              <Text className="font-bold text-ink">Digite EXCLUIR para confirmar</Text>

              <TextInput
                accessibilityLabel="Digite EXCLUIR para confirmar"
                value={confirmation}
                autoCapitalize="characters"
                autoCorrect={false}
                onChangeText={setConfirmation}
                className="min-h-12 rounded-xl border border-outline bg-canvas px-3 text-ink"
              />

              <View className="flex-row gap-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar"
                  onPress={closeDialog}
                  className="min-h-12 flex-1 items-center justify-center rounded-xl border border-outline"
                >
                  <Text className="font-bold text-primary">Cancelar</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirmar exclusão"
                  accessibilityState={{ disabled: confirmation !== "EXCLUIR" || busy }}
                  disabled={confirmation !== "EXCLUIR" || busy}
                  onPress={() => void erase()}
                  className="min-h-12 flex-1 items-center justify-center rounded-xl bg-danger-solid"
                >
                  <Text className="font-bold text-on-danger">Confirmar exclusão</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}
