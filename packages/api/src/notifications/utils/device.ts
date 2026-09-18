import { HttpBadRequestError } from '@ez4/gateway';
import { DevicePlatform, type DeviceRegistration } from '@receivy/common';

const EXPO_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;
const INSTALLATION_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Only an Expo push token from a known platform is stored; anything else is refused before the transaction. */
export function assertDeviceRegistration(input: DeviceRegistration): void {
  if (!EXPO_TOKEN.test(input.token) || input.token.length > 300) {
    throw new HttpBadRequestError('Dispositivo inválido.');
  }

  if (!INSTALLATION_ID.test(input.installationId)) {
    throw new HttpBadRequestError('Dispositivo inválido.');
  }

  if (![DevicePlatform.Ios, DevicePlatform.Android].includes(input.platform)) {
    throw new HttpBadRequestError('Dispositivo inválido.');
  }
}
