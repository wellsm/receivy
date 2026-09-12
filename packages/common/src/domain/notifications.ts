export type DeviceRegistration = {
  token: string;
  installationId: string;
  platform: 'ios' | 'android';
};
export type NotificationDevice = {
  id: string;
  platform: 'ios' | 'android';
  active: boolean;
  createdAt: string;
};
