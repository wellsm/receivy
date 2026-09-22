"use client";

import { type ManualReminderResult, NOBODY_REACHABLE, PREVIEW_UNAVAILABLE, remindLines } from "@receivy/common";
import { Bell } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type RemindDialogProps = {
  recipientName: string;
  preview: ManualReminderResult | null;
  loading: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function RemindDialog({ recipientName, preview, loading, busy, onConfirm, onCancel }: RemindDialogProps) {
  const lines = preview ? remindLines(preview) : null;
  const nobody = preview !== null && preview.channels.length === 0;
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
