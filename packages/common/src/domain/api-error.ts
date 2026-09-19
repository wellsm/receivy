const CONFLICT = 'O registro mudou ou esta ação já foi realizada. Atualize antes de tentar novamente.';
const INVALID = 'Confira os dados informados.';
const RATE_LIMITED = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
const PAYMENT_PLAN_REQUIRED = 'Esse recurso faz parte do plano Básico.';

/** Generic copy when the status alone says enough; other statuses keep the screen's own fallback. */
const byStatus: Record<number, string> = { 400: INVALID, 402: PAYMENT_PLAN_REQUIRED, 409: CONFLICT, 422: INVALID, 429: RATE_LIMITED };

/** Statuses whose `message` is domain copy written for the user (see docs/api-errors.md). */
const WITH_COPY = new Set([402, 409, 422, 429]);

/** The one 429 the app explains on its own: manual reminders are limited to one per charge per day. */
export const REMINDER_QUOTA_MESSAGE = 'Já foi enviado um lembrete nas últimas 24 horas.';

type ErrorBody = { message?: unknown; context?: { code?: unknown } };

/**
 * Copy for a failed response. Conflicts, validation failures and quotas carry their own
 * user-facing `message`; 400 gets generic validation copy; anything else keeps the fallback the
 * screen chose. Gateway text (401/403/404/5xx) is never displayed.
 */
export function apiErrorMessage(status: number, body: unknown, fallback: string): string {
  const message = (body as ErrorBody | null)?.message;

  if (WITH_COPY.has(status) && typeof message === 'string' && message) {
    return message;
  }

  return byStatus[status] ?? fallback;
}

/** Stable machine code of a domain error (`context.code`), for callers that branch on it. */
export function apiErrorCode(body: unknown): string | undefined {
  const code = (body as ErrorBody | null)?.context?.code;

  return typeof code === 'string' ? code : undefined;
}
