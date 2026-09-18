import type { DbClient } from '../../database';
import { DeviceRepository } from '../repositories/device';
import type { NotificationTransport } from './transport';

export type DirectNotice = { title: string; body: string; url: string };

/**
 * A one-off push to every active device of a user, outside any charge: nothing to retry, a device the
 * provider no longer knows is simply switched off. Failures never reach the caller.
 */
export async function pushToUser(db: DbClient, transport: NotificationTransport, userId: string, notice: DirectNotice): Promise<void> {
  const devices = await DeviceRepository.active(db, userId);

  for (const device of devices) {
    const result = await transport.push({ token: device.token, ...notice });

    if (result.status === 'device_unregistered') {
      await DeviceRepository.deactivate(db, device.id, new Date().toISOString());
    }
  }
}
