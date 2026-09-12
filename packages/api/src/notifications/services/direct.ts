import type { DbClient } from '../../database';
import type { NotificationTransport } from './transport';

export type DirectNotice = { title: string; body: string; url: string };

/**
 * A one-off push to every active device of a user, outside any charge: nothing to retry, a device the
 * provider no longer knows is simply switched off. Failures never reach the caller.
 */
export async function pushToUser(db: DbClient, transport: NotificationTransport, userId: string, notice: DirectNotice): Promise<void> {
  const { records } = await db.device_tokens.findMany({
    select: { id: true, token: true },
    where: { user_id: userId, active: true },
    take: 10
  });

  for (const device of records) {
    const result = await transport.push({ token: device.token, ...notice });

    if (result.status === 'device_unregistered') {
      await db.device_tokens.updateOne({ where: { id: device.id }, data: { active: false, updated_at: new Date().toISOString() } });
    }
  }
}
