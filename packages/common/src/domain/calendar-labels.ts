/** Whole days between two calendar dates (`YYYY-MM-DD`), positive when `to` comes after `from`. */
export function dayDiff(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);

  const ms = Date.UTC(toYear!, toMonth! - 1, toDay!) - Date.UTC(fromYear!, fromMonth! - 1, fromDay!);

  return Math.round(ms / 86_400_000);
}

/** Short hint under a contact: how long since the last billing that involved them. */
export function lastBilledHint(lastBilledAt: string | null, today: string): string {
  if (!lastBilledAt) {
    return 'Sem cobranças';
  }

  const days = dayDiff(lastBilledAt.slice(0, 10), today);

  if (days <= 0) {
    return 'Hoje';
  }

  if (days === 1) {
    return 'Ontem';
  }

  if (days < 7) {
    return `${days}d`;
  }

  if (days < 30) {
    return `${Math.floor(days / 7)}sem`;
  }

  return `${Math.floor(days / 30)}m`;
}

/** `dd/mm` for an instant or calendar date, always read in UTC so the day never shifts. */
export function shortDayMonth(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
}
