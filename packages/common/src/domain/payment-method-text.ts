import { pixKeyField } from './contact-format';
import { PaymentProvider, PixKeyType } from './contracts';

export const PIX_KIND_LABELS: Record<PixKeyType, string> = {
  [PixKeyType.Cpf]: 'CPF',
  [PixKeyType.Cnpj]: 'CNPJ',
  [PixKeyType.Phone]: 'Celular',
  [PixKeyType.Email]: 'E-mail',
  [PixKeyType.Random]: 'Chave aleatória'
};

export type PaymentMethodText = { title: string; value: string };

/** How a method reads on a list, a picker or a dialog: its kind as the title, its value as people know it. */
export function paymentMethodText(method: { provider: PaymentProvider; kind: PixKeyType | null; value: string }): PaymentMethodText {
  if (method.provider === PaymentProvider.InfinitePay || !method.kind) {
    return { title: 'InfinitePay', value: `$${method.value}` };
  }

  return { title: PIX_KIND_LABELS[method.kind], value: pixKeyField(method.kind).format(method.value) };
}
