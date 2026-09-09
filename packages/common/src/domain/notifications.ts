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
export type NotificationDelivery = {
  id: string;
  channel: 'email' | 'push';
  template: 'initial' | 'reminder' | 'manual';
  state: 'pending' | 'sending' | 'accepted' | 'delivered' | 'disabled' | 'failed' | 'uncertain' | 'suppressed';
  attempts: number;
  reason: string | null;
  updatedAt: string;
};
