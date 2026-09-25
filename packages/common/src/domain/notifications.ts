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
  Unavailable = 'unavailable',
  /** The owner sends from their own number and that number is not connected right now. */
  SenderOffline = 'sender_offline',
  /** The owner sends from the Receivy number and the plan cycle has no messages left. */
  Quota = 'quota'
}

/** Whose number a notice leaves from: the Receivy number on the Meta Cloud API, or the owner's own number on Evolution. */
export const enum WhatsappSender {
  Receivy = 'receivy',
  Own = 'own'
}

export const enum WhatsappInstanceState {
  Pending = 'pending',
  Open = 'open',
  Closed = 'closed'
}

export const enum WhatsappMessageStatus {
  Queued = 'queued',
  Sent = 'sent',
  Delivered = 'delivered',
  Read = 'read',
  Failed = 'failed'
}

export type ManualReminderResult = {
  channels: NoticeChannel[];
  dropped: { channel: NoticeChannel; reason: DropReason }[];
};
