import { Order } from '@ez4/database';
import type {
  BillingCategory,
  BillingDueRule,
  BillingFrequency,
  BillingKind,
  BillingRecurrence,
  BillingState,
  Direction,
  SplitMode
} from '@receivy/common';
import { BillingKind as BillingKindEnum, BillingRecurrence as BillingRecurrenceEnum, BillingState as BillingStateEnum, Direction as DirectionEnum } from '@receivy/common';
import { searchTerm } from '../../common/utils/search';
import type { DbClient } from '../../database';
import type { ListCursor } from '../utils/cursor';

// EZ4 0.52 optional-field typings omit SQL NULL; explicit null clears old values.
const sqlNull = null as unknown as undefined;
const SEARCH_LIMIT = 80;

export namespace BillingRepository {
  export type Row = {
    id: string;
    owner_id: string;
    recurrence: BillingRecurrence;
    kind: BillingKind;
    frequency?: BillingFrequency;
    description: string;
    category: BillingCategory;
    total_cents: number;
    start_date: string;
    end_date?: string;
    due_rule: BillingDueRule;
    payment_method_id?: string;
    contact_id?: string;
    reminders?: string;
    state: BillingState;
    /** Null only until the block 3 backfill runs; reads as 'equal'. */
    split_mode?: SplitMode;
    last_occurrence_date?: string;
    request_hash: string;
    created_at: string;
    updated_at: string;
    owner: { reminder_config?: string };
  };

  export type Filters = {
    type?: Direction;
    cursor?: ListCursor;
    search?: string;
  };

  export type Insert = {
    id: string;
    ownerId: string;
    recurrence: BillingRecurrence;
    kind: BillingKind;
    frequency?: BillingFrequency;
    description: string;
    category: BillingCategory;
    totalCents: number;
    startDate: string;
    endDate?: string;
    dueRule: BillingDueRule;
    paymentMethodId?: string;
    contactId?: string;
    reminders?: string;
    splitMode: SplitMode;
    lastOccurrenceDate?: string;
    idempotencyKey: string;
    requestHash: string;
    now: string;
  };

  export type Update = {
    description?: string;
    category?: BillingCategory;
    totalCents?: number;
    /** `null` clears the pointer; absent keeps it. */
    paymentMethodId?: string | null;
    contactId?: string | null;
    reminders?: string;
    splitMode?: SplitMode;
    state?: BillingState;
    startDate?: string;
    dueRule?: BillingDueRule;
    lastOccurrenceDate?: string;
  };

  export async function get(db: DbClient, ownerId: string, id: string, lock = false): Promise<Row | null> {
    const row = await db.billings.findOne({
      select: {
        id: true,
        owner_id: true,
        recurrence: true,
        kind: true,
        frequency: true,
        description: true,
        category: true,
        total_cents: true,
        start_date: true,
        end_date: true,
        due_rule: true,
        payment_method_id: true,
        contact_id: true,
        reminders: true,
        state: true,
        split_mode: true,
        last_occurrence_date: true,
        request_hash: true,
        created_at: true,
        updated_at: true,
        owner: { reminder_config: true }
      },
      where: { id, owner_id: ownerId },
      ...(lock ? { lock: true } : {})
    });

    return row ?? null;
  }

  /** The billing an owner already created with this Idempotency-Key, if any. */
  export async function byIdempotencyKey(db: DbClient, ownerId: string, key: string): Promise<Row | null> {
    const row = await db.billings.findOne({
      select: {
        id: true,
        owner_id: true,
        recurrence: true,
        kind: true,
        frequency: true,
        description: true,
        category: true,
        total_cents: true,
        start_date: true,
        end_date: true,
        due_rule: true,
        payment_method_id: true,
        contact_id: true,
        reminders: true,
        state: true,
        split_mode: true,
        last_occurrence_date: true,
        request_hash: true,
        created_at: true,
        updated_at: true,
        owner: { reminder_config: true }
      },
      where: { owner_id: ownerId, idempotency_key: key }
    });

    return row ?? null;
  }

  /** What a public invite preview shows of a billing, with the name of its owner. */
  export async function publicView(
    db: DbClient,
    id: string
  ): Promise<{
    id: string;
    owner_id: string;
    description: string;
    total_cents: number;
    recurrence: BillingRecurrence;
    category: BillingCategory;
    state: BillingState;
    owner: { name?: string };
  } | null> {
    const row = await db.billings.findOne({
      select: { id: true, owner_id: true, description: true, total_cents: true, recurrence: true, category: true, state: true, owner: { name: true } },
      where: { id }
    });

    return row ?? null;
  }

  export async function idsOwnedBy(db: DbClient, ownerId: string, lock = false): Promise<string[]> {
    const { records } = await db.billings.findMany({ select: { id: true }, where: { owner_id: ownerId }, ...(lock ? { lock: true } : {}) });

    return records.map((row) => row.id);
  }

  /** What stays of an erased owner's billing: ended, unnamed, with no key and no reminders. */
  export async function markErased(db: DbClient, id: string, now: string): Promise<void> {
    await db.billings.updateOne({
      where: { id },
      data: { state: BillingStateEnum.Ended, description: 'Registro de conta excluída', payment_method: { id: sqlNull }, reminders: sqlNull, updated_at: now }
    });
  }

  export async function remove(db: DbClient, id: string): Promise<void> {
    await db.billings.deleteOne({ where: { id } });
  }

  export async function ownerOf(db: DbClient, id: string): Promise<string | null> {
    const row = await db.billings.findOne({ select: { owner_id: true }, where: { id } });

    return row?.owner_id ?? null;
  }

  /** One page of the owner's billings, newest first; `take` rows at most. */
  export async function list(db: DbClient, ownerId: string, filters: Filters, take: number): Promise<Row[]> {
    const query = searchTerm(filters.search ?? '', SEARCH_LIMIT);
    const { cursor } = filters;
    const { records } = await db.billings.findMany({
      select: {
        id: true,
        owner_id: true,
        recurrence: true,
        kind: true,
        frequency: true,
        description: true,
        category: true,
        total_cents: true,
        start_date: true,
        end_date: true,
        due_rule: true,
        payment_method_id: true,
        contact_id: true,
        reminders: true,
        state: true,
        split_mode: true,
        last_occurrence_date: true,
        request_hash: true,
        created_at: true,
        updated_at: true,
        owner: { reminder_config: true }
      },
      where: {
        AND: [
          { owner_id: ownerId },
          ...(filters.type ? [filters.type === DirectionEnum.Payable ? { contact_id: { isNull: false } } : { contact_id: { isNull: true } }] : []),
          ...(query ? [{ description: { contains: query, insensitive: true } }] : []),
          ...(cursor ? [{ OR: [{ created_at: { lt: cursor.createdAt } }, { created_at: cursor.createdAt, id: { gt: cursor.id } }] }] : [])
        ]
      },
      order: { created_at: Order.Desc, id: Order.Asc },
      take
    });

    return records;
  }

  /** Every active assinatura, for the daily sweep. */
  export async function activeIndefiniteIds(db: DbClient, recurrence: BillingRecurrence, state: BillingState): Promise<string[]> {
    const { records } = await db.billings.findMany({ select: { id: true }, where: { recurrence, state }, order: { id: Order.Asc } });

    return records.map((row) => row.id);
  }

  /** What the plan counts: the owner's live, active, receivable assinaturas. */
  export async function countActiveIndefinite(db: DbClient, ownerId: string): Promise<number> {
    return db.billings.count({
      where: { owner_id: ownerId, recurrence: BillingRecurrenceEnum.Indefinite, state: BillingStateEnum.Active, kind: BillingKindEnum.Live, contact_id: { isNull: true } }
    });
  }

  /** The owner's live, active, receivable assinaturas, newest first: what a downgrade trims. */
  export async function activeIndefiniteByOwner(db: DbClient, ownerId: string): Promise<Array<{ id: string; created_at: string }>> {
    const { records } = await db.billings.findMany({
      select: { id: true, created_at: true },
      where: { owner_id: ownerId, recurrence: BillingRecurrenceEnum.Indefinite, state: BillingStateEnum.Active, kind: BillingKindEnum.Live, contact_id: { isNull: true } },
      order: { created_at: Order.Desc }
    });

    return records;
  }

  /** Every active billing of the owner paid through one of the given methods; a registro never depends on a checkout link. */
  export async function activeByPaymentMethods(db: DbClient, ownerId: string, methodIds: string[]): Promise<string[]> {
    if (!methodIds.length) {
      return [];
    }

    const { records } = await db.billings.findMany({
      select: { id: true },
      where: { owner_id: ownerId, state: BillingStateEnum.Active, kind: BillingKindEnum.Live, payment_method_id: { isIn: methodIds } }
    });

    return records.map((row) => row.id);
  }

  /** Every registro, with its owner, for the daily settlement. */
  export async function ofKind(db: DbClient, kind: BillingKind): Promise<{ id: string; ownerId: string }[]> {
    const { records } = await db.billings.findMany({ select: { id: true, owner_id: true }, where: { kind }, order: { id: Order.Asc } });

    return records.map((row) => ({ id: row.id, ownerId: row.owner_id }));
  }

  export async function insert(db: DbClient, input: Insert): Promise<Row> {
    return db.billings.insertOne({
      select: {
        id: true,
        owner_id: true,
        recurrence: true,
        kind: true,
        frequency: true,
        description: true,
        category: true,
        total_cents: true,
        start_date: true,
        end_date: true,
        due_rule: true,
        payment_method_id: true,
        contact_id: true,
        reminders: true,
        state: true,
        split_mode: true,
        last_occurrence_date: true,
        request_hash: true,
        created_at: true,
        updated_at: true,
        owner: { reminder_config: true }
      },
      data: {
        id: input.id,
        owner: { id: input.ownerId },
        recurrence: input.recurrence,
        kind: input.kind,
        frequency: input.frequency ?? sqlNull,
        description: input.description,
        category: input.category,
        total_cents: input.totalCents,
        start_date: input.startDate,
        end_date: input.endDate ?? sqlNull,
        due_rule: input.dueRule,
        ...(input.paymentMethodId ? { payment_method: { id: input.paymentMethodId } } : {}),
        ...(input.contactId ? { contact: { id: input.contactId } } : {}),
        reminders: input.reminders ?? sqlNull,
        state: 'active' as BillingState,
        split_mode: input.splitMode,
        last_occurrence_date: input.lastOccurrenceDate ?? sqlNull,
        idempotency_key: input.idempotencyKey,
        request_hash: input.requestHash,
        created_at: input.now,
        updated_at: input.now
      }
    });
  }

  export async function update(db: DbClient, id: string, input: Update, now: string): Promise<void> {
    await db.billings.updateOne({
      where: { id },
      data: {
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.totalCents !== undefined ? { total_cents: input.totalCents } : {}),
        ...(input.paymentMethodId !== undefined ? { payment_method: { id: input.paymentMethodId ?? sqlNull } } : {}),
        ...(input.contactId !== undefined ? { contact: { id: input.contactId ?? sqlNull } } : {}),
        ...(input.reminders !== undefined ? { reminders: input.reminders } : {}),
        ...(input.splitMode !== undefined ? { split_mode: input.splitMode } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.startDate !== undefined ? { start_date: input.startDate } : {}),
        ...(input.dueRule !== undefined ? { due_rule: input.dueRule } : {}),
        ...(input.lastOccurrenceDate !== undefined ? { last_occurrence_date: input.lastOccurrenceDate } : {}),
        updated_at: now
      }
    });
  }
}
