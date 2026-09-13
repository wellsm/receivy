import type { PixKeyType } from './contracts';
import { BadgeTone } from './feed';

export const enum PixKeyboard {
  Numeric = 'numeric',
  Tel = 'tel',
  Email = 'email',
  Text = 'text'
}

export type PixKeyField = {
  label: string;
  placeholder: string;
  keyboard: PixKeyboard;
  format: (value: string) => string;
  unformat: (value: string) => string;
};

export type ContactBadge = { label: string; tone: BadgeTone };

export function onlyDigits(value: string): string {
  if (!value) {
    return '';
  }

  return value.replace(/\D/g, '');
}

/** Drops the Brazilian country code so a stored `+5511987654321` masks like a locally typed number. */
function localPhoneDigits(value: string): string {
  const digits = onlyDigits(value);

  if (digits.length >= 12 && digits.length <= 13 && digits.startsWith('55')) {
    return digits.slice(2);
  }

  return digits.slice(0, 11);
}

export function formatPhoneBR(value: string): string {
  const digits = localPhoneDigits(value);

  if (!digits) {
    return '';
  }

  if (digits.length <= 2) {
    return `(${digits}`;
  }

  const area = digits.slice(0, 2);
  const rest = digits.slice(2);

  if (rest.length <= 4) {
    return `(${area}) ${rest}`;
  }

  // Only an eleven-digit number carries the ninth digit, so the split moves once the last one arrives.
  const split = digits.length > 10 ? 5 : 4;

  return `(${area}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

function groupDigits(value: string, size: number, groups: { at: number; separator: string }[]): string {
  const digits = onlyDigits(value).slice(0, size);

  if (!digits) {
    return '';
  }

  let formatted = '';
  let index = 0;

  for (const group of groups) {
    if (digits.length <= group.at) {
      break;
    }

    formatted += digits.slice(index, group.at) + group.separator;
    index = group.at;
  }

  return formatted + digits.slice(index);
}

export function formatCpf(value: string): string {
  return groupDigits(value, 11, [
    { at: 3, separator: '.' },
    { at: 6, separator: '.' },
    { at: 9, separator: '-' }
  ]);
}

export function formatCnpj(value: string): string {
  return groupDigits(value, 14, [
    { at: 2, separator: '.' },
    { at: 5, separator: '.' },
    { at: 8, separator: '/' },
    { at: 12, separator: '-' }
  ]);
}

/** The API normalizes a phone key as `+` plus every digit, so the country code has to travel with it. */
function unformatPhoneKey(value: string): string {
  const digits = localPhoneDigits(value);

  if (!digits) {
    return '';
  }

  return `+55${digits}`;
}

const keep = (value: string) => value;
const trimmed = (value: string) => value.trim();

const PIX_KEY_FIELDS: Record<PixKeyType, PixKeyField> = {
  cpf: {
    label: 'CPF do titular',
    placeholder: '000.000.000-00',
    keyboard: PixKeyboard.Numeric,
    format: formatCpf,
    unformat: onlyDigits
  },
  cnpj: {
    label: 'CNPJ',
    placeholder: '00.000.000/0000-00',
    keyboard: PixKeyboard.Numeric,
    format: formatCnpj,
    unformat: onlyDigits
  },
  phone: {
    label: 'Telefone celular',
    placeholder: '(00) 00000-0000',
    keyboard: PixKeyboard.Tel,
    format: formatPhoneBR,
    unformat: unformatPhoneKey
  },
  email: {
    label: 'E-mail Pix',
    placeholder: 'seu.email@exemplo.com.br',
    keyboard: PixKeyboard.Email,
    format: keep,
    unformat: trimmed
  },
  random: {
    label: 'Chave aleatória',
    placeholder: '89a456bc-1234-…',
    keyboard: PixKeyboard.Text,
    format: keep,
    unformat: trimmed
  }
};

export function pixKeyField(type: PixKeyType): PixKeyField {
  return PIX_KEY_FIELDS[type];
}

export function initialsOf(name: string): string {
  const words = name.normalize('NFC').trim().split(/\s+/).filter(Boolean);

  if (!words.length) {
    return '';
  }

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase('pt-BR'))
    .join('');
}

export function contactBadge(activeCharges: number): ContactBadge {
  if (activeCharges <= 0) {
    return { label: 'Sem pendências', tone: BadgeTone.Success };
  }

  return { label: `${activeCharges} ${activeCharges === 1 ? 'ativa' : 'ativas'}`, tone: BadgeTone.Warning };
}
