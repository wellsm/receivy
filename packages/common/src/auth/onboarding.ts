import { UserStatus } from '../domain/contacts';
import type { AuthUser } from './auth';

export type OnboardingProfile = Pick<AuthUser, 'status'>;

/**
 * An account stays `pending` until the person confirms name and phone on the onboarding screen,
 * whether it was created by their own login or by someone adding them as a contact.
 */
export function needsOnboarding(user: OnboardingProfile | null | undefined): boolean {
  if (!user) {
    return true;
  }

  return user.status !== UserStatus.Active;
}
