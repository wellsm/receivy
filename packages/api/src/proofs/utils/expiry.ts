/**
 * Kept out of the scheduler so the repository can name a schedule without importing the module that
 * imports it back: a value cycle there boots the bundled handler with a half-initialised binding.
 */
export const uploadExpiryIdentifier = (chargeId: string) => `charge:${chargeId}:upload-expiry`;
