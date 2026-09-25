import { type ChannelSet, DropReason, NoticeChannel, WhatsappSender } from '@receivy/common';

export { DropReason, NoticeChannel };

export type Dropped = { channel: NoticeChannel.Email | NoticeChannel.WhatsApp; reason: DropReason };

export type ReachTarget = { email?: string; phone?: string; email_opt_out_at?: string; whatsapp_opt_out_at?: string };

export type ReachContact = { phone?: string; consentAt?: string } | null;

export type ResolveInput = {
  wanted: ChannelSet;
  ownBill: boolean;
  target: ReachTarget;
  contact: ReachContact;
  whatsappAvailable: boolean;
  /** Whose number the owner sends from, and its state, as `whatsappReach` reads them. */
  sender: WhatsappSender;
  instanceOpen: boolean;
  quotaLeft: number;
};

export type Resolved = { email: boolean; whatsapp: boolean; phone?: string; dropped: Dropped[] };

/** The order is the spec's: the recipient first, then the environment, then the owner's sender. */
function whatsappDrop(input: ResolveInput): DropReason | null {
  const own = Boolean(input.target.phone);
  const phone = input.target.phone ?? input.contact?.phone;

  if (!phone) {
    return DropReason.NoPhone;
  }

  if (!own && !input.contact?.consentAt) {
    return DropReason.NoConsent;
  }

  if (input.target.whatsapp_opt_out_at) {
    return DropReason.OptedOut;
  }

  if (!input.whatsappAvailable) {
    return DropReason.Unavailable;
  }

  if (input.sender === WhatsappSender.Own) {
    return input.instanceOpen ? null : DropReason.SenderOffline;
  }

  if (input.quotaLeft <= 0) {
    return DropReason.Quota;
  }

  return null;
}

/** Push is implicit and decided by the devices; this settles the two configurable channels and says why one fell. */
export function resolveChannels(input: ResolveInput): Resolved {
  const dropped: Dropped[] = [];

  let email = false;
  let whatsapp = false;
  let phone: string | undefined;

  if (input.wanted.email) {
    if (!input.target.email) {
      dropped.push({ channel: NoticeChannel.Email, reason: DropReason.NoEmail });
    } else if (input.target.email_opt_out_at) {
      dropped.push({ channel: NoticeChannel.Email, reason: DropReason.OptedOut });
    } else {
      email = true;
    }
  }

  // The owner reminding themself never pays for WhatsApp: the channel is not even wanted.
  if (input.wanted.whatsapp && !input.ownBill) {
    const reason = whatsappDrop(input);

    if (reason) {
      dropped.push({ channel: NoticeChannel.WhatsApp, reason });
    } else {
      whatsapp = true;
      phone = input.target.phone ?? input.contact?.phone;
    }
  }

  return { email, whatsapp, ...(phone ? { phone } : {}), dropped };
}
