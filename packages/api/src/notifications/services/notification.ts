import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { ChargeState, type DeviceRegistration, Direction, type ManualReminderResult, type NotificationDevice, type ReminderConfig } from '@receivy/common';
import { billingRegistered } from '../../billings/utils/columns';
import { effectiveConfigOf } from '../../billings/utils/reminders';
import { ChargeClosedError, ChargeInReviewError, SettledNoRemindersError } from '../../charges/errors';
import { ChargeRepository } from '../../charges/repositories/charge';
import { StoredProofState } from '../../charges/schemas/charge';
import { chargeForActor } from '../../charges/services/access';
import { ownerPays } from '../../charges/utils/columns';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { EmailService } from '../../common/services/email/service';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { Db, DbClient } from '../../database';
import { ProofRepository } from '../../proofs/repositories/proof';
import { AccountRepository } from '../../users/repositories/account';
import { SessionRepository } from '../../users/repositories/sessions';
import { DeviceOwnedElsewhereError, DeviceRegisteredError, ReminderQuotaError } from '../errors';
import { DeviceRepository } from '../repositories/device';
import type { ChargeNotifyScheduler } from '../schedulers/charge-notify';
import { assertDeviceRegistration } from '../utils/device';
import { NoticeChannel, resolveChannels } from './channels';
import { noticeContext } from './context';
import { type NoticeContext, NoticeTemplate, sendChargeNotice } from './send';

export type NotificationClient = {
  registerDevice(userId: string, input: DeviceRegistration, familyId?: string): Promise<NotificationDevice>;
  manualReminder(userId: string, chargeId: string): Promise<ManualReminderResult>;
  reminderPreview(userId: string, chargeId: string): Promise<ManualReminderResult>;
};

export declare class NotificationService extends Factory.Service<NotificationClient> {
  handler: typeof createService;

  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    PAYMENT_METHOD_LINK: Environment.VariableOrValue<'PAYMENT_METHOD_LINK', 'disabled'>;
    PAYMENT_CREDENTIAL_KEY_B64: Environment.VariableOrValue<'PAYMENT_CREDENTIAL_KEY_B64', 'disabled'>;
    EMAIL_TRANSPORT: Environment.Variable<'EMAIL_TRANSPORT'>;
    RESEND_FROM_EMAIL: Environment.Variable<'RESEND_FROM_EMAIL'>;
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    PUBLIC_API_ORIGIN: Environment.VariableOrValue<'PUBLIC_API_ORIGIN', 'http://127.0.0.1:3735/local-receivy-api'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
  };

  services: {
    db: Environment.Service<Db>;
    email: Environment.Service<EmailService>;
    chargeNotifyScheduler: Environment.Service<ChargeNotifyScheduler>;
    variables: Environment.ServiceVariables;
  };
}

async function audit(db: DbClient, userId: string, id: string, type: string): Promise<void> {
  await EventRepository.record(db, { type, eventableType: EventableType.Notification, eventableId: id, actorId: userId });
}

/** One row per person and installation: the same installation re-registering only refreshes its token. */
export async function registerDevice(db: DbClient, userId: string, input: DeviceRegistration, familyId?: string): Promise<NotificationDevice> {
  assertDeviceRegistration(input);

  return db.transaction(async (tx) => {
    if (!(await AccountRepository.isLive(tx, userId, true))) {
      throw new HttpNotFoundError();
    }

    if (familyId && !(await SessionRepository.familyLive(tx, userId, familyId))) {
      throw new HttpForbiddenError();
    }

    const token = await DeviceRepository.byToken(tx, input.token);

    if (token && token.user_id !== userId) {
      throw new DeviceOwnedElsewhereError();
    }

    const existing = await DeviceRepository.byInstallation(tx, userId, input.installationId);

    if (token && token.id !== existing?.id) {
      throw new DeviceRegisteredError();
    }

    const now = new Date().toISOString();
    const id = existing?.id ?? crypto.randomUUID();

    if (existing) {
      await DeviceRepository.refresh(tx, id, { token: input.token, familyId, platform: input.platform }, now);
    } else {
      await DeviceRepository.insert(tx, { id, userId, token: input.token, installationId: input.installationId, familyId, platform: input.platform, now });
    }

    await audit(tx, userId, id, 'notifications.device_registered');

    return { id, platform: input.platform, active: true, createdAt: existing?.created_at ?? now };
  });
}

/** The gates a manual reminder must clear, shared by the button that sends one and the preview that only looks. */
async function manualTarget(db: DbClient, userId: string, chargeId: string, lock = false): Promise<{ row: ChargeRepository.Row; config: ReminderConfig }> {
  const { row, direction } = await chargeForActor(db, userId, chargeId, lock);

  // Reminders belong to the creditor of a conta a receber; a conta a pagar reminds its own owner on schedule.
  if (direction !== Direction.Receivable || ownerPays(row)) {
    throw new HttpForbiddenError();
  }

  if (row.state !== ChargeState.Pending) {
    throw new ChargeClosedError();
  }

  const charge = await ChargeRepository.forNotice(db, chargeId);

  // A registro has nobody to remind: the owner settled it on purpose.
  if (charge && billingRegistered(charge.billing)) {
    throw new SettledNoRemindersError();
  }

  if ((await ProofRepository.current(db, row.id))?.state === StoredProofState.Pending) {
    throw new ChargeInReviewError();
  }

  if (!charge) {
    throw new HttpNotFoundError();
  }

  return { row, config: effectiveConfigOf(charge.billing) };
}

/** The channels a manual reminder would reach right now, on the owner's manual configuration, without sending anything. */
export async function reminderPreview(db: DbClient, userId: string, chargeId: string, notice: NoticeContext): Promise<ManualReminderResult> {
  const { config } = await manualTarget(db, userId, chargeId);
  const charge = (await ChargeRepository.forNotice(db, chargeId))!;
  const target = charge.debtor && !charge.debtor.deleted_at ? charge.debtor : undefined;

  if (!target) {
    return { channels: [], dropped: [] };
  }

  const reach = charge.creditor_id ? await ContactRepository.reachability(db, charge.creditor_id, target.id) : null;
  const resolved = resolveChannels({ wanted: config.manual, ownBill: ownerPays(charge), target, contact: reach, whatsappAvailable: notice.config.whatsappAvailable });
  const devices = await DeviceRepository.active(db, target.id);
  const channels: NoticeChannel[] = [
    ...(devices.length && notice.config.pushAvailable !== false ? [NoticeChannel.Push] : []),
    ...(resolved.email ? [NoticeChannel.Email] : []),
    ...(resolved.whatsapp ? [NoticeChannel.WhatsApp] : [])
  ];

  return { channels, dropped: resolved.dropped };
}

/** The creditor presses the button: the channels their configuration keeps for manual reminders, one a day per charge. */
export async function manualReminder(db: DbClient, userId: string, chargeId: string, notice: NoticeContext, clock = Date.now): Promise<ManualReminderResult> {
  const now = clock();

  const { config } = await db.transaction(async (tx) => {
    const { config } = await manualTarget(tx, userId, chargeId, true);

    // Only a reminder that reached someone counts towards the daily quota.
    const recent = (await EventRepository.list(tx, chargeId, 'notice.sent')).filter(
      (event) => event.payload['template'] === NoticeTemplate.Manual && Date.parse(event.created_at) > now - 24 * 3600_000
    );

    if (recent.length) {
      throw new ReminderQuotaError();
    }

    await audit(tx, userId, chargeId, 'notifications.manual_reminder_requested');

    return { config };
  });

  return sendChargeNotice(db, notice, chargeId, NoticeTemplate.Manual, now, { channels: config.manual });
}

export function createService({ db, email, variables }: Service.Context<NotificationService>): NotificationClient {
  return {
    registerDevice: (userId, input, familyId) => registerDevice(db, userId, input, familyId),
    reminderPreview: (userId, chargeId) => reminderPreview(db, userId, chargeId, noticeContext({ variables, email })),
    manualReminder: (userId, chargeId) => manualReminder(db, userId, chargeId, noticeContext({ variables, email }))
  };
}
