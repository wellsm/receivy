import type { ChargeDetail, ExpenseDetail, ExpenseInput, PaymentMethod, PaymentMethodInput, PaymentMethodsPage, PersonLedger, PublicLink, TimelinePage, ProofDetail, ProofUploadIntent, ProofUploadInput, RecurrenceInput, RecurrenceDetail, RecurrencesPage } from "@receivy/common";
import { authClient } from "@/auth/client";

type Options = { authenticatedFetch: (path: string, init?: RequestInit) => Promise<Response>; publicWebBaseUrl?: string };

export class FinancialRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "FinancialRequestError"; }
}

async function message(response: Response, fallback: string) { try { const body = await response.json() as { message?: unknown }; return typeof body.message === "string" ? body.message : fallback; } catch { return fallback; } }

export function createFinancialClient({ authenticatedFetch, publicWebBaseUrl }: Options) {
  async function request<T>(path: string, init?: RequestInit, fallback = "Não foi possível acessar seus registros financeiros."): Promise<T> {
    const response = await authenticatedFetch(path, init);
    if (!response.ok) throw new FinancialRequestError(await message(response, fallback), response.status);
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }
  return {
    recurrences() { return request<RecurrencesPage>("recurrences"); },
    recurrence(id: string) { return request<RecurrenceDetail>(`recurrences/${id}`); },
    recurrenceProfile() { return request<{ user: { timezone: string } }>("auth/me"); },
    saveRecurrence(input: RecurrenceInput, key: string, id?: string) { return request<RecurrenceDetail>(id ? `recurrences/${id}` : "recurrences", { method: id ? "PATCH" : "POST", headers: { "idempotency-key": key }, body: JSON.stringify(input) }); },
    transitionRecurrence(id: string, action: "pause" | "reactivate" | "end") { return request<RecurrenceDetail>(`recurrences/${id}/${action}`, { method: "POST" }); },
    timeline(query = "") { return request<TimelinePage>(`timeline${query ? `?${query}` : ""}`); },
    paymentMethods() { return request<PaymentMethodsPage>("payment-methods"); },
    savePaymentMethod(input: PaymentMethodInput, id?: string) { return request<PaymentMethod>(id ? `payment-methods/${id}` : "payment-methods", { method: id ? "PATCH" : "POST", body: JSON.stringify(input) }); },
    defaultPaymentMethod(id: string) { return request<PaymentMethod>(`payment-methods/${id}/default`, { method: "POST" }); },
    archivePaymentMethod(id: string) { return request<void>(`payment-methods/${id}/archive`, { method: "POST" }); },
    createExpense(input: ExpenseInput, idempotencyKey: string) { return request<ExpenseDetail>("expenses", { method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify(input) }, "Não foi possível criar a cobrança."); },
    charge(id: string) { return request<ChargeDetail>(`charges/${id}`); },
    proofs(id: string) { return request<{ proofs: ProofDetail[] }>(`charges/${id}/proofs`); },
    uploadIntent(id: string, input: ProofUploadInput) { return request<ProofUploadIntent>(`charges/${id}/proofs/uploads`, { method: "POST", body: JSON.stringify(input) }); },
    finalizeProof(id: string, intentId: string) { return request<ProofDetail>(`charges/${id}/proofs/uploads/${intentId}/finalize`, { method: "POST" }); },
    reviewProof(id: string, proofId: string, decision: "accepted" | "rejected", reason?: string) { return request<ProofDetail>(`charges/${id}/proofs/${proofId}/review`, { method: "POST", body: JSON.stringify({ decision, reason }) }); },
    downloadProof(id: string, proofId: string) { return request<{ url: string; expiresIn: number }>(`charges/${id}/proofs/${proofId}/download`, { method: "POST" }); },
    cancel(id: string) { return request<ChargeDetail>(`charges/${id}/cancel`, { method: "POST" }); },
    pay(id: string, method: "pix" | "cash" | "transfer" | "other" = "pix") { return request<ChargeDetail>(`charges/${id}/payments`, { method: "POST", body: JSON.stringify({ method }) }); },
    publicLink(id: string, rotate = false) { return request<PublicLink>(`charges/${id}/public-link${rotate ? "/rotate" : ""}`, { method: "POST" }); },
    revokePublicLink(id: string) { return request<void>(`charges/${id}/public-link`, { method: "DELETE" }); },
    ledger(id: string, cursor?: string) { return request<PersonLedger>(`people/${id}/ledger${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`); },
    publicChargeUrl(token: string) {
      if (!publicWebBaseUrl) throw new Error("Configure EXPO_PUBLIC_WEB_URL para compartilhar links públicos.");
      let base: URL; try { base = new URL(publicWebBaseUrl); } catch { throw new Error("EXPO_PUBLIC_WEB_URL precisa ser uma URL web válida."); }
      if (!/^https?:$/.test(base.protocol)) throw new Error("EXPO_PUBLIC_WEB_URL precisa usar http ou https.");
      return new URL(`/pay/${encodeURIComponent(token)}`, base).toString();
    },
  };
}

export const financialClient = createFinancialClient({ authenticatedFetch: authClient.authenticatedFetch, publicWebBaseUrl: process.env.EXPO_PUBLIC_WEB_URL });
export type FinancialClient = ReturnType<typeof createFinancialClient>;
