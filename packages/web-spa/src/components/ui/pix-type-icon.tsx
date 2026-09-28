import type { PixKeyType } from "@receivy/common";
import { Building2, IdCard, KeyRound, Mail, Smartphone, type LucideIcon } from "lucide-react";

export const PIX_TYPE_ICONS: Record<PixKeyType, LucideIcon> = {
  cpf: IdCard,
  cnpj: Building2,
  phone: Smartphone,
  email: Mail,
  random: KeyRound,
};

export const PIX_TYPE_LABELS: Record<PixKeyType, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  phone: "Celular",
  email: "E-mail",
  random: "Chave aleatória",
};

export function PixTypeIcon({ type, size = 18, className }: { type: PixKeyType; size?: number; className?: string }) {
  const Icon = PIX_TYPE_ICONS[type] ?? KeyRound;

  return <Icon size={size} aria-hidden="true" className={className} />;
}
