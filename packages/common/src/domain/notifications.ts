export const enum DevicePlatform {
  Ios = 'ios',
  Android = 'android'
}

export type DeviceRegistration = {
  token: string;
  installationId: string;
  platform: DevicePlatform;
};
export type NotificationDevice = {
  id: string;
  platform: DevicePlatform;
  active: boolean;
  createdAt: string;
};
