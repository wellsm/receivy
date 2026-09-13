import type { UserStatus } from '../domain/contacts';

export const enum AuthProvider {
  Email = 'email',
  Google = 'google',
  Apple = 'apple'
}

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  /** Filled at onboarding by the person; the base for future WhatsApp validation. */
  phone: string | null;
  avatarUrl: string | null;
  /** 'pending' until onboarding completes; 'active' afterwards; 'removed' after account deletion. */
  status: UserStatus;
  locale: 'pt-BR';
  timezone: string;
  country: 'BR';
  currency: 'BRL';
};

export type RequestEmailCodeBody = {
  email: string;
};

export type ConfirmEmailCodeBody = RequestEmailCodeBody & {
  code: string;
  deviceName?: string;
};

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type AuthSessionResponse = SessionTokens & {
  user: AuthUser;
};

export type RefreshSessionBody = {
  refreshToken: string;
};

export type LogoutBody = RefreshSessionBody;

export function normalizeEmail(email: string): string {
  return email.normalize('NFC').trim().toLowerCase();
}
