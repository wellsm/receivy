import { type BillingDraft, type Contact, formatMoney, groupNoticeNote, SplitMode, splitModeBadge, type UserAvatar } from "@receivy/common";
import { Image } from "expo-image";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { useThemeColors } from "@/theme/colors";

const bellMark = require("../../../../assets/images/auth/bell.svg");
const plusMark = require("../../../../assets/images/auth/plus.svg");
const groupMark = require("../../../../assets/images/auth/group.svg");

/** The segmented control shows the short label; the accessible name keeps the full one. */
export const SPLIT_MODES: { value: SplitMode; label: string; name: string }[] = [
  { value: SplitMode.Equal, label: "Igual", name: "Igual" },
  { value: SplitMode.Shares, label: "Cotas", name: "Cotas" },
  { value: SplitMode.Percentage, label: "%", name: "Porcentagem" },
  { value: SplitMode.Fixed, label: "Fixo", name: "Valor fixo" },
];

const FIELD_LABELS: Record<Exclude<SplitMode, "equal">, string> = {
  shares: "Cotas",
  fixed: "Valor",
  percentage: "Porcentagem",
};

export const BELL_NOTE = "Sino riscado = sem aviso automático. Você ainda pode lembrar à mão.";

/** One line of the Divisão panel: a participant, or the owner as "Eu". */
export type SplitPerson = {
  /** The contact's account id, or `owner`. */
  key: string;
  name: string;
  avatar?: UserAvatar | null;
  owner: boolean;
  /** What the split gives this person; absent while the screen cannot be priced. */
  amountCents?: number;
  /** The typed value for the current mode (shares, percent or amount). */
  value: string;
  /** Whether an automatic notice can reach this person at all. */
  notifiable: boolean;
  /** Whether it will: the bell. */
  notify: boolean;
  /** A read-only line instead of a field: the owner's remainder on a fixed split. */
  readonlyText?: string;
};

function money(amountCents: number): string {
  return formatMoney({ amountCents, currency: "BRL" });
}

/**
 * The bell of a participant: whole when the notice goes out, struck through when it does not. `idle` (no channel, or a
 * group carries the notice) keeps it on the row, dimmer than a plain disabled control.
 */
function Bell({ name, on, idle, disabled, onToggle }: { name: string; on: boolean; idle: boolean; disabled: boolean; onToggle: () => void }) {
  const colors = useThemeColors();
  const dim = idle ? "opacity-30" : disabled ? "opacity-50" : "";

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={`Avisar ${name}`}
      accessibilityState={{ checked: on, disabled: disabled || idle }}
      disabled={disabled || idle}
      onPress={onToggle}
      className={`h-9 w-9 items-center justify-center rounded-xl ${on ? "bg-primary-soft" : "bg-surface-muted"} ${dim}`}
    >
      <Image source={bellMark} tintColor={on ? colors.primaryStrong : colors.muted} style={{ width: 16, height: 16 }} />
      {!on && <View className="absolute h-[2px] w-5 rotate-45 rounded-full bg-muted" />}
    </Pressable>
  );
}

function Stepper({ name, value, disabled, onChange }: { name: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const count = Number(value) || 1;

  return (
    <View className={`h-9 flex-row items-center rounded-xl border border-outline bg-surface ${disabled ? "opacity-50" : ""}`}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Menos cotas de ${name}`} disabled={disabled || count <= 1} onPress={() => onChange(String(count - 1))} className="h-9 w-8 items-center justify-center">
        <Text className="font-sans text-base font-bold text-primary-strong">–</Text>
      </Pressable>
      <TextInput
        accessibilityLabel={`Cotas de ${name}`}
        editable={!disabled}
        inputMode="numeric"
        value={value}
        placeholder="1"
        onChangeText={onChange}
        className="h-9 w-8 py-0 text-center font-sans text-[14px] font-bold text-ink"
      />
      <Pressable accessibilityRole="button" accessibilityLabel={`Mais cotas de ${name}`} disabled={disabled} onPress={() => onChange(String(count + 1))} className="h-9 w-8 items-center justify-center">
        <Text className="font-sans text-base font-bold text-primary-strong">+</Text>
      </Pressable>
    </View>
  );
}

type SplitPanelProps = {
  draft: BillingDraft;
  people: SplitPerson[];
  /** What is missing for the split to close, or empty. */
  hint: string;
  /** "5 cotas · R$ 10,78 cada", under the rows. */
  footer: string;
  totalCents: number;
  disabled: boolean;
  onMode: (mode: SplitMode) => void;
  onValue: (key: string, value: string) => void;
  onNotify: (key: string, notify: boolean) => void;
  onRemove: (key: string) => void;
  onOwner: (participates: boolean) => void;
  onAdd: () => void;
  /** Present when the owner's own WhatsApp is connected: the notices can go to a group instead. */
  group?: {
    current: { name: string } | null;
    onPick: () => void;
    onClear: () => void;
  };
};

/** "Avisar no grupo": off, it offers the picker; on, it names the group and lets it go. */
function GroupRow({ group, disabled }: { group: NonNullable<SplitPanelProps["group"]>; disabled: boolean }) {
  const colors = useThemeColors();

  return (
    <View className="flex-row items-center gap-3 rounded-[18px] border border-outline bg-surface px-3 py-2.5">
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-success-soft">
        <Image source={groupMark} tintColor={colors.success} style={{ width: 17, height: 17 }} />
      </View>
      <View className="flex-1">
        <Text className="font-sans text-[11.5px] text-muted">Avisar no grupo</Text>
        <Text className="font-sans text-[14px] font-bold text-ink" numberOfLines={1}>
          {group.current ? group.current.name : "Cada pessoa no privado"}
        </Text>
      </View>
      {group.current && (
        <Pressable accessibilityRole="button" accessibilityLabel="Avisar cada pessoa" accessibilityState={{ disabled }} disabled={disabled} onPress={group.onClear} className="h-9 w-7 items-center justify-center">
          <Image source={plusMark} tintColor={colors.muted} style={{ width: 14, height: 14, transform: [{ rotate: "45deg" }] }} />
        </Pressable>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel="Escolher grupo" accessibilityState={{ disabled }} disabled={disabled} onPress={group.onPick} className="min-h-9 justify-center px-1">
        <Text className="font-sans text-[13px] font-bold text-primary">{group.current ? "Trocar" : "Escolher"}</Text>
      </Pressable>
    </View>
  );
}

/** Step 2 of the creation and the Divisão sheet of the edit: the mode tabs, one row per person, Eu with its switch. */
export function SplitPanel({ draft, people, hint, footer, totalCents, disabled, onMode, onValue, onNotify, onRemove, onOwner, onAdd, group }: SplitPanelProps) {
  // A group carries the notice: the bells say nothing while it does.
  const grouped = Boolean(group?.current);
  const colors = useThemeColors();
  const keys = people.filter((person) => !person.owner || draft.owner).map((person) => person.key);
  const badge = splitModeBadge(draft, keys);

  return (
    <View className="gap-3">
      <View accessibilityLabel="Divisão" className={`flex-row rounded-[14px] bg-surface-muted p-1 ${disabled ? "opacity-60" : ""}`}>
        {SPLIT_MODES.map((option) => {
          const active = draft.mode === option.value;

          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={option.name}
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => onMode(option.value)}
              className={`h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-[11px] ${active ? "bg-surface shadow-sm" : ""}`}
            >
              <Text className={`font-sans text-[13px] ${active ? "font-bold text-ink" : "font-semibold text-muted"}`}>{option.label}</Text>
              {active && badge !== null && (
                <View className="min-w-[22px] items-center rounded-full bg-primary px-1.5 py-0.5">
                  <Text className="font-sans text-[11px] font-bold text-on-primary">{badge}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      <View className="overflow-hidden rounded-[18px] border border-outline bg-surface">
        {people.map((person, index) => {
          const out = person.owner && !draft.owner;
          const amount = person.amountCents !== undefined && !out ? money(person.amountCents) : "";
          const bellOn = person.notifiable && !grouped;

          return (
            <View key={person.key} className={`min-h-[60px] flex-row items-center gap-2.5 px-3 py-2 ${index ? "border-t border-outline/60" : ""} ${out ? "opacity-50" : ""}`}>
              {person.owner ? <InitialsAvatar name="Eu" size={32} inverted /> : <InitialsAvatar name={person.name} size={32} avatar={person.avatar} />}
              <View className="flex-1">
                <View className="flex-row items-center gap-1.5">
                  <Text className="font-sans text-[14px] font-bold text-ink" numberOfLines={1}>
                    {person.name}
                  </Text>
                  {person.owner && <Text className="rounded-md bg-surface-muted px-1.5 py-0.5 font-sans text-[9.5px] font-bold text-muted">VOCÊ</Text>}
                </View>
                {person.readonlyText ? (
                  <Text className="font-sans text-[12px] font-semibold text-primary-strong">{person.readonlyText}</Text>
                ) : amount ? (
                  <Text className="font-sans text-[12.5px] text-muted">{amount}</Text>
                ) : null}
              </View>

              {!person.readonlyText && !out && draft.mode === SplitMode.Shares && (
                <Stepper name={person.name} value={person.value} disabled={disabled} onChange={(value) => onValue(person.key, value)} />
              )}
              {!person.readonlyText && !out && (draft.mode === SplitMode.Percentage || draft.mode === SplitMode.Fixed) && (
                <View className="flex-row items-center gap-1">
                  <TextInput
                    accessibilityLabel={`${FIELD_LABELS[draft.mode]} de ${person.name}`}
                    editable={!disabled}
                    inputMode="decimal"
                    placeholder="0"
                    placeholderTextColor={colors.muted}
                    value={person.value}
                    onChangeText={(value) => onValue(person.key, value)}
                    className={`h-9 rounded-xl border border-outline bg-surface px-2 py-0 text-right font-sans text-[14px] font-bold text-ink ${draft.mode === SplitMode.Fixed ? "w-24" : "w-14"}`}
                  />
                  {draft.mode === SplitMode.Percentage && <Text className="font-sans text-xs text-muted">%</Text>}
                </View>
              )}

              {/* One fixed column for the bell and × or the owner's switch, so every field before it lines up. */}
              {person.owner ? (
                <View className="w-[74px] items-center">
                  <Switch accessibilityLabel="Eu também participo" disabled={disabled} value={draft.owner} onValueChange={onOwner} trackColor={{ true: colors.primary }} />
                  <Text className="font-sans text-[9.5px] font-semibold text-muted">participo</Text>
                </View>
              ) : (
                <View className="w-[74px] flex-row items-center justify-end gap-2.5">
                  <Bell
                    name={person.name}
                    on={bellOn && person.notify}
                    idle={!bellOn}
                    disabled={disabled}
                    onToggle={() => onNotify(person.key, !person.notify)}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remover ${person.name}`}
                    accessibilityState={{ disabled }}
                    disabled={disabled}
                    onPress={() => onRemove(person.key)}
                    className="h-9 w-7 items-center justify-center"
                  >
                    <Image source={plusMark} tintColor={colors.muted} style={{ width: 14, height: 14, transform: [{ rotate: "45deg" }] }} />
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Adicionar"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onAdd}
          className={`min-h-[52px] flex-row items-center gap-2.5 border-t border-outline/60 px-3 ${disabled ? "opacity-50" : ""}`}
        >
          <View className="h-8 w-8 items-center justify-center rounded-full border border-dashed border-primary">
            <Image source={plusMark} tintColor={colors.primary} style={{ width: 13, height: 13 }} />
          </View>
          <Text className="font-sans text-[13.5px] font-bold text-primary">Adicionar pessoa</Text>
        </Pressable>
      </View>

      {hint ? (
        <View className="flex-row items-center justify-between gap-3 rounded-xl bg-danger-soft px-3 py-2.5">
          <Text className="flex-1 font-sans text-[12.5px] font-semibold text-danger">{hint}</Text>
        </View>
      ) : null}

      {(footer || totalCents > 0) && (
        <View className="flex-row items-center justify-between gap-3">
          <Text className="font-sans text-[12.5px] text-muted">{footer}</Text>
          {totalCents > 0 && <Text className="font-sans text-[12.5px] font-bold text-success">fecha {money(totalCents)}</Text>}
        </View>
      )}

      {group && <GroupRow group={group} disabled={disabled} />}

      {group?.current ? (
        <Text className="px-0.5 font-sans text-[12px] leading-4 text-muted">{groupNoticeNote(group.current.name)}</Text>
      ) : null}

      {!grouped && people.some((person) => !person.owner && person.notifiable) && (
        <View className="flex-row items-start gap-2 px-0.5">
          <Image source={bellMark} tintColor={colors.muted} style={{ width: 14, height: 14, marginTop: 2 }} />
          <Text className="flex-1 font-sans text-[12px] leading-4 text-muted">{BELL_NOTE}</Text>
        </View>
      )}
    </View>
  );
}

type SeatPanelProps = {
  /** "Para quem" on a conta a pagar, "De quem" on a registro a receber. */
  label: string;
  hint: string;
  seated: Contact | null;
  /** The seat of a registro never moves once created. */
  locked: boolean;
  disabled: boolean;
  onPick: () => void;
  onClear: () => void;
};

/** The other side of a conta a pagar or a registro: one contact, picked from the agenda. */
export function SeatPanel({ label, hint, seated, locked, disabled, onPick, onClear }: SeatPanelProps) {
  const colors = useThemeColors();

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="font-sans text-[11px] font-semibold uppercase tracking-[0.88px] text-muted">{label}</Text>
        {!locked && seated && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Escolher contato"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onPick}
            className="min-h-10 flex-row items-center gap-1 px-1"
          >
            <Image source={plusMark} tintColor={colors.primaryStrong} style={{ width: 14, height: 14 }} />
            <Text className="text-xs font-semibold text-primary">Trocar</Text>
          </Pressable>
        )}
      </View>

      {seated ? (
        <View className="min-h-[60px] flex-row items-center gap-2.5 rounded-[18px] border border-outline bg-surface px-3 py-2">
          <InitialsAvatar name={seated.displayName} size={32} avatar={seated.avatar} />
          <Text className="flex-1 font-sans text-[14px] font-bold text-ink" numberOfLines={1}>
            {seated.displayName}
          </Text>
          {!locked && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={seated.displayName}
              accessibilityHint="Remove da conta"
              accessibilityState={{ selected: true, disabled }}
              disabled={disabled}
              onPress={onClear}
              className="h-9 w-7 items-center justify-center"
            >
              <Image source={plusMark} tintColor={colors.muted} style={{ width: 14, height: 14, transform: [{ rotate: "45deg" }] }} />
            </Pressable>
          )}
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Adicionar"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPick}
          className="min-h-[60px] flex-row items-center gap-2.5 rounded-[18px] border border-dashed border-primary/60 bg-surface px-3"
        >
          <View className="h-8 w-8 items-center justify-center rounded-full border border-dashed border-primary">
            <Image source={plusMark} tintColor={colors.primary} style={{ width: 13, height: 13 }} />
          </View>
          <View className="flex-1">
            <Text className="font-sans text-[13.5px] font-bold text-primary">Adicionar pessoa</Text>
            <Text className="font-sans text-[11px] text-muted">{hint}</Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}
