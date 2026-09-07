import type { ChargeDetail, ExpenseDetail, ExpenseInput, PaymentMethod, PaymentMethodInput, PaymentMethodsPage, PersonLedger, PublicLink, TimelinePage } from "@receivy/common";
import { authClient } from "@/auth/client";

type Options = { authenticatedFetch: (path: string, init?: RequestInit) => Promise<Response>; publicWebBaseUrl?: string };

async function message(response: Response, fallback: string) { try { const body = await response.json() as { message?: unknown }; return typeof body.message === "string" ? body.message : fallback; } catch { return fallback; } }

export function createFinancialClient({ authenticatedFetch, publicWebBaseUrl }: Options) {
  async function request<T>(path: string, init?: RequestInit, fallback = "Não foi possível acessar seus registros financeiros."): Promise<T> {
    const response = await authenticatedFetch(path, init);
    if (!response.ok) throw new Error(await message(response, fallback));
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }
  return {
    timeline(query = "") { return request<TimelinePage>(`timeline${query ? `?${query}` : ""}`); },
    paymentMethods() { return request<PaymentMethodsPage>("payment-methods"); },
    savePaymentMethod(input: PaymentMethodInput, id?: string) { return request<PaymentMethod>(id ? `payment-methods/${id}` : "payment-methods", { method: id ? "PATCH" : "POST", body: JSON.stringify(input) }); },
    defaultPaymentMethod(id: string) { return request<PaymentMethod>(`payment-methods/${id}/default`, { method: "POST" }); },
    archivePaymentMethod(id: string) { return request<void>(`payment-methods/${id}/archive`, { method: "POST" }); },
    createExpense(input: ExpenseInput, idempotencyKey: string) { return request<ExpenseDetail>("expenses", { method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify(input) }, "Não foi possível criar a cobrança."); },
    charge(id: string) { return request<ChargeDetail>(`charges/${id}`); },
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
