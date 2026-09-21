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

export const enum NoticeChannel {
  Push = 'push',
  Email = 'email',
  WhatsApp = 'whatsapp'
}

export const enum DropReason {
  NoEmail = 'no_email',
  NoPhone = 'no_phone',
  NoConsent = 'no_consent',
  OptedOut = 'opted_out',
  Unavailable = 'unavailable'
}

export type ManualReminderResult = {
  channels: NoticeChannel[];
  dropped: { channel: NoticeChannel; reason: DropReason }[];
};
