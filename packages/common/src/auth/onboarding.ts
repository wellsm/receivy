import type { AuthUser } from './auth';

export type OnboardingProfile = Pick<AuthUser, 'name'>;

/**
 * The name is the only field a person must fill before using the app: every
 * charge, reminder and public link shows it to the other side.
 */
export function needsOnboarding(user: OnboardingProfile | null | undefined): boolean {
  if (!user) {
    return true;
  }

  return !user.name?.trim();
}
