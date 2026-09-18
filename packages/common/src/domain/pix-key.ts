import { PixKeyType } from './contracts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validDigits(value: string, size: 11 | 14): boolean {
  if (value.length !== size || /^(\d)\1+$/.test(value)) {
    return false;
  }

  const check = (base: string, weights: number[]) => {
    const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0);
    const remainder = sum % 11;

    return remainder < 2 ? 0 : 11 - remainder;
  };

  if (size === 11) {
    return (
      check(value, [10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(value[9]) &&
      check(value, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(value[10])
    );
  }

  return (
    check(value, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(value[12]) &&
    check(value, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(value[13])
  );
}

export function normalizePixKey(type: PixKeyType, value: string): string {
  const trimmed = value.normalize('NFC').trim();
  let normalized: string;
  let valid: boolean;

  if (type === PixKeyType.Cpf || type === PixKeyType.Cnpj) {
    normalized = trimmed.replace(/\D/g, '');
    valid = validDigits(normalized, type === PixKeyType.Cpf ? 11 : 14);
  } else if (type === PixKeyType.Email) {
    normalized = trimmed.toLowerCase();
    valid = normalized.length <= 254 && EMAIL.test(normalized);
  } else if (type === PixKeyType.Phone) {
    normalized = `+${trimmed.replace(/\D/g, '')}`;
    valid = /^\+[1-9]\d{7,14}$/.test(normalized);
  } else if (type === PixKeyType.Random) {
    normalized = trimmed.toLowerCase();
    valid = UUID.test(normalized);
  } else {
    normalized = '';
    valid = false;
  }
  if (!valid) {
    throw new RangeError('Chave Pix inválida.');
  }

  return normalized;
}
