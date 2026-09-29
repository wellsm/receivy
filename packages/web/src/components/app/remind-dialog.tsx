import { type ManualReminderResult, NOBODY_REACHABLE, NoticeChannel, PREVIEW_UNAVAILABLE, remindLines } from "@receivy/common";
import { Bell } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { whatsappEnabled } from "@/lib/whatsapp-flag";

type RemindDialogProps = {
  recipientName: string;
  preview: ManualReminderResult | null;
  loading: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** The kill switch off drops WhatsApp from the preview entirely: never a channel going out, never a reason it was not. */
function visiblePreview(preview: ManualReminderResult): ManualReminderResult {
  if (whatsappEnabled()) {
    return preview;
  }

  return {
    channels: preview.channels.filter(channel => channel !== NoticeChannel.WhatsApp),
    dropped: preview.dropped.filter(drop => drop.channel !== NoticeChannel.WhatsApp),
  };
}

export function RemindDialog({ recipientName, preview, loading, busy, onConfirm, onCancel }: RemindDialogProps) {
  const visible = preview ? visiblePreview(preview) : null;
  const lines = visible ? remindLines(visible) : null;
  const nobody = visible !== null && visible.channels.length === 0;
  const unavailable = !loading && preview === null;

  return (
    <ConfirmDialog
      title={`Lembrar ${recipientName}?`}
      icon={Bell}
      tone="primary"
      explanation={
        loading
          ? "Conferindo por onde avisar…"
          : unavailable
            ? PREVIEW_UNAVAILABLE
            : nobody
              ? NOBODY_REACHABLE
              : `Vai por: ${lines?.going}. Só um lembrete a cada 24 horas.`
      }
      details={lines?.dropped}
      confirmLabel="Enviar lembrete"
      busy={busy}
      disabled={loading || nobody}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
