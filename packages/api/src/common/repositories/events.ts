import { Order } from '@ez4/database';
import type { DbClient } from '../../database';
import type { EventableType } from '../schemas/event';

const sqlNull = null as unknown as undefined;

export namespace EventRepository {
  export type Input = {
    type: string;
    eventableType: EventableType;
    eventableId: string;
    actorId?: string | null;
    payload?: Record<string, unknown>;
    at?: string;
  };

  export type Row = {
    id: string;
    type: string;
    actor_user_id?: string;
    payload: Record<string, unknown>;
    created_at: string;
  };

  /** Appends one line to the log. Never fails the caller's transaction on its own: the row is plain data. */
  export async function record(db: DbClient, input: Input): Promise<string> {
    const id = crypto.randomUUID();

    await db.events.insertOne({
      data: {
        id,
        eventable_type: input.eventableType,
        eventable_id: input.eventableId,
        type: input.type,
        ...(input.actorId ? { actor_user: { id: input.actorId } } : {}),
        payload: input.payload ?? {},
        created_at: input.at ?? new Date().toISOString()
      }
    });

    return id;
  }

  /** Every line `from` wrote now reads as written by `to`. */
  export async function reassignActor(db: DbClient, from: string, to: string): Promise<void> {
    await db.events.updateMany({ where: { actor_user_id: from }, data: { actor_user: { id: to } } });
  }

  /** The lines an erased account wrote stay, with nobody named on them. */
  /** The whole history of one target. */
  export async function removeOf(db: DbClient, eventableType: EventableType, eventableId: string): Promise<void> {
    await db.events.deleteMany({ where: { eventable_type: eventableType, eventable_id: eventableId } });
  }

  export async function forgetActor(db: DbClient, userId: string): Promise<void> {
    await db.events.updateMany({ where: { actor_user_id: userId }, data: { actor_user: { id: sqlNull } } });
  }

  /** Newest first; `type` narrows to one kind of event. */
  export async function list(db: DbClient, eventableId: string, type?: string, take = 50): Promise<Row[]> {
    const { records } = await db.events.findMany({
      select: { id: true, type: true, actor_user_id: true, payload: true, created_at: true },
      where: { eventable_id: eventableId, ...(type ? { type } : {}) },
      order: { created_at: Order.Desc },
      take
    });

    return records as Row[];
  }
}
