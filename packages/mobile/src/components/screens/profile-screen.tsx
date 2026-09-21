import { useEffect, useState, type ReactNode } from "react";
import Constants from "expo-constants";
import { Image } from "expo-image";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ACCOUNT_DELETED, ACCOUNT_DELETION_UNCONFIRMED, momentText, planName, PlanTier, THEME_PREFERENCE_OPTIONS, type AuthUser, type PlanSummary } from "@receivy/common";
import { pickAndUploadAvatar } from "@/account/avatar";
import { accountClient, type AccountClient } from "@/account/client";
import { financialClient, type FinancialClient } from "@/financial/client";
import { profileStore, type ProfileStore } from "@/account/profile";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { useTabHeader } from "@/navigation/tab-header";
import { LegalSheet, type LegalKind } from "@/components/app/legal-sheet";
import { useThemeColors, type ThemeColors } from "@/theme/colors";
import { useThemePreference } from "@/theme/preference";

type ProfileScreenProps = {
  client?: Pick<AccountClient, "profile" | "save" | "logout" | "erase" | "startAvatarUpload" | "completeAvatarUpload">;
  store?: Pick<ProfileStore, "remember">;
  plans?: Pick<FinancialClient, "plan">;
  version?: string;
  onOpenContacts?: () => void;
  onOpenPaymentMethods?: () => void;
  onOpenReminders?: () => void;
  onLoggedOut?: () => void;
};

type Dialog = "logout" | "delete" | null;

const ICONS = {
  bell: require("../../../assets/images/auth/bell.svg"),
  check: require("../../../assets/images/auth/check.svg"),
  chevron: require("../../../assets/images/auth/chevron.svg"),
  edit: require("../../../assets/images/auth/edit.svg"),
  group: require("../../../assets/images/auth/group.svg"),
  key: require("../../../assets/images/auth/key.svg"),
  logout: require("../../../assets/images/auth/logout.svg"),
  star: require("../../../assets/images/auth/star.svg"),
  trash: require("../../../assets/images/auth/trash.svg"),
  warning: require("../../../assets/images/auth/warning.svg"),
} as const;

type Tone = "primary" | "success" | "neutral" | "danger";

const TILES: Record<Tone, { box: string; tint: keyof ThemeColors }> = {
  primary: { box: "bg-primary-soft", tint: "primaryStrong" },
  success: { box: "bg-success-soft", tint: "success" },
  neutral: { box: "bg-surface-muted", tint: "ink" },
  danger: { box: "bg-danger-soft", tint: "danger" },
};

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
  tone: Tone;
  label: string;
  title: string;
  subtitle?: string;
  chevron?: boolean;
  disabled?: boolean;
  onPress?: () => void;
};

function Row({ icon, tone, label, title, subtitle, chevron = true, disabled = false, onPress }: RowProps) {
  const colors = useThemeColors();
  const tile = TILES[tone];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className="min-h-14 flex-row items-center gap-3 px-4 py-3.5"
    >
      <View className={`h-[38px] w-[38px] items-center justify-center rounded-xl ${tile.box}`}>
        <Image source={ICONS[icon]} tintColor={colors[tile.tint]} style={{ width: 18, height: 18 }} />
      </View>

      <View className="flex-1">
        <Text className={`font-sans text-[14.5px] font-semibold ${tone === "danger" ? "text-danger" : "text-ink"}`}>{title}</Text>
        {subtitle ? <Text className="font-sans text-[11.5px] text-muted">{subtitle}</Text> : null}
      </View>

      {chevron && <Image source={ICONS.chevron} tintColor={colors.muted} style={{ width: 16, height: 16 }} />}
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="px-1 font-sans text-[11px] font-semibold tracking-[0.88px] text-muted">{title}</Text>
      {children}
    </View>
  );
}

export function ProfileScreen({
  client = accountClient,
  store = profileStore,
  plans = financialClient,
  version = Constants.expoConfig?.version ?? "1.0.0",
  onOpenContacts,
  onOpenPaymentMethods,
  onOpenReminders,
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
  const [photoBusy, setPhotoBusy] = useState(false);
  const [ended, setEnded] = useState(false);
  const [legal, setLegal] = useState<LegalKind | null>(null);
  const [plan, setPlan] = useState<PlanSummary | null>(null);
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

  useEffect(() => {
    let active = true;

    plans.plan().then(
      (summary) => active && setPlan(summary),
      () => active && setPlan(null),
    );

    return () => {
      active = false;
    };
  }, [plans]);

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

  async function changePhoto() {
    if (!user) {
      return;
    }

    setPhotoBusy(true);
    setNotice("");

    try {
      const avatar = await pickAndUploadAvatar(client);

      if (avatar) {
        setUser({ ...user, avatar });
      }
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Não foi possível trocar a foto.");
    } finally {
      setPhotoBusy(false);
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

  useTabHeader({ title: "Perfil" });

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View className="gap-[18px] px-5 pt-3">
          {notice ? (
            <Text accessibilityLiveRegion="polite" className="rounded-2xl bg-surface-muted p-4 font-sans leading-5 text-ink">
              {notice}
            </Text>
          ) : null}

          {!ended && user ? (
            <>
              <View className="flex-row items-center gap-3.5 rounded-3xl bg-primary p-5">
                <View className="h-16 w-16">
                  <InitialsAvatar name={user.name?.trim() || "R"} size={64} avatar={user.avatar} />

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Trocar foto"
                    accessibilityState={{ disabled: photoBusy, busy: photoBusy }}
                    disabled={photoBusy}
                    onPress={() => void changePhoto()}
                    className="absolute -bottom-1 -right-1 h-7 w-7 items-center justify-center rounded-full bg-surface"
                  >
                    {photoBusy ? (
                      <ActivityIndicator size="small" color={colors.primaryStrong} />
                    ) : (
                      <Image source={ICONS.edit} tintColor={colors.primaryStrong} style={{ width: 13, height: 13 }} />
                    )}
                  </Pressable>
                </View>

                <View className="min-w-0 flex-1">
                  {editing ? (
                    <View className="flex-row items-center gap-2">
                      <TextInput
                        accessibilityLabel="Nome"
                        value={draft}
                        maxLength={120}
                        onChangeText={setDraft}
                        textAlignVertical="center"
                        className="h-11 flex-1 rounded-xl bg-surface px-3 py-0 font-sans text-[16px] tracking-normal text-ink"
                      />

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Salvar nome"
                        accessibilityState={{ disabled: busy || !draft.trim() }}
                        disabled={busy || !draft.trim()}
                        onPress={() => void saveName()}
                        className="h-11 w-11 items-center justify-center rounded-xl bg-surface"
                      >
                        <Image source={ICONS.check} tintColor={colors.primaryStrong} style={{ width: 20, height: 20 }} />
                      </Pressable>
                    </View>
                  ) : (
                    <Text className="font-display text-xl font-bold text-on-primary" numberOfLines={1}>
                      {user.name ?? "Sem nome"}
                    </Text>
                  )}

                  <Text className="mt-0.5 font-sans text-[12.5px] text-on-primary/80" numberOfLines={1}>
                    {user.email}
                  </Text>
                </View>

                {!editing && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Editar nome"
                    accessibilityState={{ disabled: busy }}
                    disabled={busy}
                    onPress={() => {
                      setDraft(user.name ?? "");
                      setEditing(true);
                    }}
                    className="h-[34px] w-[34px] items-center justify-center rounded-xl bg-on-primary/20"
                  >
                    <Image source={ICONS.edit} tintColor={colors.onPrimary} style={{ width: 16, height: 16 }} />
                  </Pressable>
                )}
              </View>

              {plan ? (
                <Section title="PLANO">
                  <View className="rounded-[20px] border border-outline bg-surface p-4">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-base font-bold text-ink">{`Plano ${planName(plan.plan)}`}</Text>
                      <Image source={ICONS.star} tintColor={colors.primaryStrong} style={{ width: 18, height: 18 }} />
                    </View>

                    <Text className="mt-2 text-sm text-ink">{`${plan.usage.indefinite.used} de ${plan.usage.indefinite.limit} cobranças indefinidas`}</Text>

                    <View className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted">
                      {(() => {
                        const ratio = plan.usage.indefinite.used / Math.max(1, plan.usage.indefinite.limit);

                        return (
                          <View
                            className={ratio >= 0.8 ? "h-full bg-warning" : "h-full bg-primary"}
                            style={{ width: `${Math.min(100, ratio * 100)}%` }}
                          />
                        );
                      })()}
                    </View>

                    {plan.plan === PlanTier.Basic && plan.currentPeriodEnd ? (
                      <Text className="mt-2 text-sm text-muted">
                        {plan.cancelAtPeriodEnd ? `Cancela em ${momentText(plan.currentPeriodEnd)}` : `Renova em ${momentText(plan.currentPeriodEnd)}`}
                      </Text>
                    ) : null}

                    <Text className="mt-2 text-xs text-muted">Gerencie seu plano no site.</Text>
                  </View>
                </Section>
              ) : null}

              <Section title="GERENCIAMENTO">
                <View className="overflow-hidden rounded-[20px] border border-outline bg-surface">
                  <Row
                    icon="group"
                    tone="primary"
                    label="Gerenciar contatos"
                    title="Meus Contatos"
                    subtitle="Gerenciar pessoas e dados salvos de cobrança"
                    onPress={onOpenContacts}
                  />

                  <View className="mx-4 h-px bg-outline/60" />

                  <Row
                    icon="key"
                    tone="success"
                    label="Gerenciar meios de pagamento"
                    title="Meios de pagamento"
                    subtitle="Pix e InfinitePay para receber"
                    onPress={onOpenPaymentMethods}
                  />

                  <View className="mx-4 h-px bg-outline/60" />

                  <Row
                    icon="bell"
                    tone="primary"
                    label="Configurar lembretes"
                    title="Lembretes"
                    subtitle="Quando e por onde avisar quem te deve"
                    onPress={onOpenReminders}
                  />
                </View>
              </Section>

              <Section title="APARÊNCIA">
                <View accessibilityRole="radiogroup" accessibilityLabel="Aparência" className="flex-row gap-1.5 rounded-[18px] border border-outline bg-surface p-1.5">
                  {THEME_PREFERENCE_OPTIONS.map((option) => {
                    const selected = option.value === themePreference;

                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityLabel={option.label}
                        accessibilityState={{ checked: selected }}
                        onPress={() => chooseTheme(option.value)}
                        className={`h-10 flex-1 items-center justify-center rounded-[13px] ${selected ? "bg-primary-soft" : ""}`}
                      >
                        <Text className={`font-sans text-[13px] ${selected ? "font-bold text-primary-strong" : "font-semibold text-muted"}`}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Section>

              <Section title="SESSÃO">
                <View className="overflow-hidden rounded-[20px] border border-outline bg-surface">
                  <Row icon="logout" tone="neutral" label="Sair da conta" title="Sair da conta" chevron={false} disabled={busy} onPress={() => setDialog("logout")} />

                  <View className="mx-4 h-px bg-outline/60" />

                  <Row
                    icon="trash"
                    tone="danger"
                    label="Excluir conta"
                    title="Excluir conta"
                    chevron={false}
                    disabled={busy}
                    onPress={() => {
                      setConfirmation("");
                      setDialog("delete");
                    }}
                  />
                </View>
              </Section>
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
                <Text className="font-sans font-bold text-primary">Termos</Text>
              </Pressable>

              <Text className="font-sans text-muted">·</Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Privacidade"
                onPress={() => setLegal("privacy")}
                className="min-h-12 justify-center"
              >
                <Text className="font-sans font-bold text-primary">Privacidade</Text>
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
              <Text accessibilityRole="header" className="font-display text-xl font-bold text-ink">
                Deseja sair da sua conta?
              </Text>

              <Text className="font-sans leading-5 text-muted">Encerrar sessão ativa neste dispositivo.</Text>

              <View className="flex-row gap-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar"
                  onPress={closeDialog}
                  className="min-h-12 flex-1 items-center justify-center rounded-2xl border border-outline"
                >
                  <Text className="font-sans font-bold text-muted">Cancelar</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Sair"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => void logout()}
                  className="min-h-12 flex-1 items-center justify-center rounded-2xl bg-primary"
                >
                  <Text className="font-sans font-bold text-on-primary">Sair</Text>
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

              <Text accessibilityRole="header" className="font-display text-xl font-bold text-ink">
                Excluir conta?
              </Text>

              <Text className="font-sans leading-5 text-muted">
                Esta ação é irreversível. Suas cobranças, contatos e chaves Pix serão apagados. Registros compartilhados
                podem ser preservados com referências anonimizadas.
              </Text>

              <Text className="font-sans font-bold text-ink">Digite EXCLUIR para confirmar</Text>

              <TextInput
                accessibilityLabel="Digite EXCLUIR para confirmar"
                value={confirmation}
                autoCapitalize="characters"
                autoCorrect={false}
                onChangeText={setConfirmation}
                className="min-h-12 rounded-xl border border-outline bg-canvas px-3 font-sans text-ink"
              />

              <View className="flex-row gap-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar"
                  onPress={closeDialog}
                  className="min-h-12 flex-1 items-center justify-center rounded-2xl border border-outline"
                >
                  <Text className="font-sans font-bold text-muted">Cancelar</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirmar exclusão"
                  accessibilityState={{ disabled: confirmation !== "EXCLUIR" || busy }}
                  disabled={confirmation !== "EXCLUIR" || busy}
                  onPress={() => void erase()}
                  className="min-h-12 flex-1 items-center justify-center rounded-2xl bg-danger-solid"
                >
                  <Text className="font-sans font-bold text-on-danger">Confirmar exclusão</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}
