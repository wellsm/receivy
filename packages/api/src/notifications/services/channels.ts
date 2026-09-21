import { type ChannelSet, DropReason, NoticeChannel } from '@receivy/common';

export { DropReason, NoticeChannel };

export type Dropped = { channel: NoticeChannel.Email | NoticeChannel.WhatsApp; reason: DropReason };

export type ReachTarget = { email?: string; phone?: string; email_opt_out_at?: string; whatsapp_opt_out_at?: string };

export type ReachContact = { phone?: string; consentAt?: string } | null;

export type ResolveInput = { wanted: ChannelSet; ownBill: boolean; target: ReachTarget; contact: ReachContact; whatsappAvailable: boolean };

export type Resolved = { email: boolean; whatsapp: boolean; dropped: Dropped[] };

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

  return null;
}

/** Push is implicit and decided by the devices; this settles the two configurable channels and says why one fell. */
export function resolveChannels(input: ResolveInput): Resolved {
  const dropped: Dropped[] = [];

  let email = false;
  let whatsapp = false;

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
    }
  }

  return { email, whatsapp, dropped };
}
