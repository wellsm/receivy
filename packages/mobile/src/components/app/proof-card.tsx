import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";
import { canMarkPaid, canUploadProof, canWithdrawProof, fileSizeText, momentText, proofNote, proofStateLabel, type ChargeDetail } from "@receivy/common";
import { StatusTag } from "@/components/ui/status-tag";
import { ACTIVE_TINT } from "@/theme/colors";

const ICONS = {
  receipt: require("../../../assets/images/auth/receipt.svg"),
  upload: require("../../../assets/images/auth/upload.svg"),
  eye: require("../../../assets/images/auth/eye.svg"),
  check: require("../../../assets/images/auth/check.svg"),
  file: require("../../../assets/images/auth/file.svg"),
  image: require("../../../assets/images/auth/image.svg"),
  trash: require("../../../assets/images/auth/trash.svg"),
} as const;

type ProofCardProps = {
  charge: ChargeDetail;
  busy: boolean;
  onView: () => void;
  onUpload: () => void;
  onAccept: () => void;
  /** Debtor only: drops the pending file so another one can be sent. */
  onWithdraw?: () => void;
};

function UploadButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-12 flex-row items-center justify-center gap-2 rounded-xl border-2 border-dashed border-outline/60 bg-surface-muted/50 px-4 ${disabled ? "opacity-50" : ""}`}
    >
      <Image source={ICONS.upload} tintColor={ACTIVE_TINT} style={{ width: 20, height: 20 }} />
      <Text className="text-sm font-semibold text-ink">{label}</Text>
    </Pressable>
  );
}

/** The proof section of a charge: the latest file with "Ver", plus accept/reject (creditor) or replace (debtor) when allowed. */
export function ProofCard({ charge, busy, onView, onUpload, onAccept, onWithdraw }: ProofCardProps) {
  const proof = charge.proof;
  const upload = canUploadProof(charge);
  // Whoever collects settles from here: accepting the file under review, or by hand when there is none to accept.
  const settle = canMarkPaid(charge);
  const withdraw = canWithdrawProof(charge) && !!onWithdraw;

  if (!proof) {
    return (
      <View className="gap-3 rounded-2xl border border-outline/30 bg-surface p-4">
        <View className="flex-row items-center gap-2">
          <Image source={ICONS.receipt} tintColor={ACTIVE_TINT} style={{ width: 20, height: 20 }} />
          <Text accessibilityRole="header" className="text-base font-bold text-ink">
            Comprovante
          </Text>
        </View>

        {upload ? (
          <>
            <UploadButton label="Enviar comprovante" disabled={busy} onPress={onUpload} />
            <Text className="text-[11px] text-muted">JPG, PNG ou PDF de até 10 MB.</Text>
          </>
        ) : (
          <Text className="text-sm text-muted">Nenhum comprovante enviado.</Text>
        )}

        {settle && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Marcar como pago"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={onAccept}
            className={`min-h-11 flex-row items-center justify-center gap-1.5 rounded-xl bg-primary ${busy ? "opacity-50" : ""}`}
          >
            <Image source={ICONS.check} tintColor="#FFFFFF" style={{ width: 16, height: 16 }} />
            <Text className="text-xs font-semibold text-white">Marcar como pago</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const state = proofStateLabel(proof);
  const note = proofNote(charge);
  const secondary = settle ? "Marcar como pago" : upload ? "Substituir" : null;

  return (
    <View className="gap-3 rounded-2xl border border-outline/30 bg-surface p-4">
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          <Image source={ICONS.receipt} tintColor={ACTIVE_TINT} style={{ width: 20, height: 20 }} />
          <Text accessibilityRole="header" className="text-base font-bold text-ink">
            Comprovante
          </Text>
        </View>
        <StatusTag label={state.label} tone={state.tone} />
      </View>

      <View className="flex-row items-center gap-3 rounded-xl border border-outline/30 bg-surface-muted p-3">
        <View className="h-10 w-10 items-center justify-center rounded-lg bg-surface">
          <Image source={proof.file.mime === "application/pdf" ? ICONS.file : ICONS.image} tintColor={ACTIVE_TINT} style={{ width: 20, height: 20 }} />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
            {proof.file.name}
          </Text>
          <Text className="text-[11px] text-muted">
            {fileSizeText(proof.file.size)} • Enviado em {momentText(proof.sentAt)}
          </Text>
        </View>
      </View>

      {note && <Text className="text-xs leading-4 text-muted">{note}</Text>}

      <View className="flex-row gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ver comprovante"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onView}
          className={`min-h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-outline/50 ${busy ? "opacity-50" : ""}`}
        >
          <Image source={ICONS.eye} tintColor={ACTIVE_TINT} style={{ width: 16, height: 16 }} />
          <Text className="text-xs font-semibold text-ink">Ver comprovante</Text>
        </Pressable>

        {withdraw && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Apagar e enviar outro"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={onWithdraw}
            className={`min-h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-red-200 ${busy ? "opacity-50" : ""}`}
          >
            <Image source={ICONS.trash} tintColor="#B91C1C" style={{ width: 16, height: 16 }} />
            <Text className="text-xs font-semibold text-red-700">Apagar e enviar outro</Text>
          </Pressable>
        )}

        {secondary && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={secondary === "Substituir" ? "Substituir comprovante" : "Marcar como pago"}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={settle ? onAccept : onUpload}
            className={`min-h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-primary ${busy ? "opacity-50" : ""}`}
          >
            <Image source={settle ? ICONS.check : ICONS.upload} tintColor="#FFFFFF" style={{ width: 16, height: 16 }} />
            <Text className="text-xs font-semibold text-white">{secondary}</Text>
          </Pressable>
        )}
      </View>

    </View>
  );
}
