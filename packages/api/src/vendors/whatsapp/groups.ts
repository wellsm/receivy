import { toWhatsappNumber, whatsappNumberVariants } from './phone';

/** A group as Evolution lists it, reduced to what the Receivy needs. */
export type EvolutionGroup = { jid: string; name: string; size: number; members: Set<string> };

type RawParticipant = { id?: unknown; phoneNumber?: unknown; jid?: unknown };
type RawGroup = { id?: unknown; subject?: unknown; size?: unknown; participants?: unknown };

/** `5511999999999@s.whatsapp.net` → `5511999999999`; an `@lid` privacy id says nothing about the phone. */
function numberOf(value: unknown): string | null {
  if (typeof value !== 'string' || !value.endsWith('@s.whatsapp.net')) {
    return null;
  }

  return value.slice(0, value.indexOf('@')).split(':')[0] ?? null;
}

/**
 * `GET /group/fetchAllGroups/{instance}?getParticipants=true`. Participants come as phone ids, or as
 * `@lid` privacy ids with the phone beside them in newer Evolution builds; either is kept when present.
 */
export function parseEvolutionGroups(body: unknown): EvolutionGroup[] {
  if (!Array.isArray(body)) {
    return [];
  }

  return body.flatMap((entry: RawGroup) => {
    if (typeof entry?.id !== 'string' || !entry.id.endsWith('@g.us')) {
      return [];
    }

    const participants = Array.isArray(entry.participants) ? (entry.participants as RawParticipant[]) : [];
    const members = new Set(participants.flatMap((participant) => [numberOf(participant.id), numberOf(participant.phoneNumber), numberOf(participant.jid)].filter((number): number is string => Boolean(number))));
    const size = typeof entry.size === 'number' ? entry.size : participants.length;

    return [{ jid: entry.id, name: typeof entry.subject === 'string' && entry.subject.trim() ? entry.subject.trim() : 'Grupo sem nome', size, members }];
  });
}

/** Whether every person is in the group, each by any of their phones and any spelling of it. */
export function groupHasEveryone(group: EvolutionGroup, people: string[][]): boolean {
  if (!people.length) {
    return false;
  }

  return people.every((phones) =>
    phones.some((phone) => {
      const number = toWhatsappNumber(phone);

      return number ? whatsappNumberVariants(number).some((variant) => group.members.has(variant)) : false;
    })
  );
}
