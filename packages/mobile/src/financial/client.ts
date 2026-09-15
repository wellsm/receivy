import type { BillingDetail, BillingGuestAction, BillingInput, BillingInvite, BillingPatch, BillingsPage, ChargeDetail, PaymentMethod, PaymentMethodInput, PaymentMethodsPage, ContactLedger, PublicLink, TimelinePage, ProofUploadTicket, ProofUploadInput } from "@receivy/common";
import { authClient } from "@/auth/client";
import { apiErrorMessage } from "@receivy/common";

type Options = { authenticatedFetch: (path: string, init?: RequestInit) => Promise<Response>; publicWebBaseUrl?: string };

export class FinancialRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "FinancialRequestError"; }
}

async function message(response: Response, fallback: string) { try { return apiErrorMessage(response.status, await response.json(), fallback); } catch { return apiErrorMessage(response.status, null, fallback); } }

export function createFinancialClient({ authenticatedFetch, publicWebBaseUrl }: Options) {
  async function request<T>(path: string, init?: RequestInit, fallback = "Não foi possível acessar seus registros financeiros."): Promise<T> {
    const response = await authenticatedFetch(path, init);
    if (!response.ok) throw new FinancialRequestError(await message(response, fallback), response.status);
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }
  return {
    billings(query = "") { return request<BillingsPage>(`billings${query ? `?${query}` : ""}`); },
    billing(id: string) { return request<BillingDetail>(`billings/${id}`); },
    profile() { return request<{ user: { timezone: string } }>("auth/me"); },
    createBilling(input: BillingInput, idempotencyKey: string) {
      return request<BillingDetail>("billings", { method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify(input) }, "Não foi possível criar a cobrança.");
    },
    patchBilling(id: string, patch: BillingPatch) {
      return request<BillingDetail>(`billings/${id}`, { method: "PATCH", body: JSON.stringify(patch) }, "Não foi possível salvar a cobrança.");
    },
    invite(id: string) { return request<BillingInvite>(`billings/${id}/invite`, { method: "POST" }, "Não foi possível criar o convite."); },
    revokeInvite(id: string) { return request<void>(`billings/${id}/invite`, { method: "DELETE" }, "Não foi possível revogar o convite."); },
    resolveGuest(billingId: string, guestId: string, action: BillingGuestAction) {
      return request<BillingDetail>(`billings/${billingId}/guests/${guestId}`, { method: "POST", body: JSON.stringify(action) }, "Não foi possível resolver o convidado.");
    },
    silenceParticipant(billingId: string, userId: string, silenced: boolean) {
      return request<BillingDetail>(`billings/${billingId}/participants/${userId}/silenced`, { method: "PUT", body: JSON.stringify({ silenced }) }, "Não foi possível atualizar os avisos.");
    },
    timeline(query = "") { return request<TimelinePage>(`timeline${query ? `?${query}` : ""}`); },
    paymentMethods() { return request<PaymentMethodsPage>("payment-methods"); },
    savePaymentMethod(input: PaymentMethodInput, id?: string) { return request<PaymentMethod>(id ? `payment-methods/${id}` : "payment-methods", { method: id ? "PATCH" : "POST", body: JSON.stringify(input) }); },
    defaultPaymentMethod(id: string) { return request<PaymentMethod>(`payment-methods/${id}/default`, { method: "POST" }); },
    archivePaymentMethod(id: string) { return request<void>(`payment-methods/${id}/archive`, { method: "POST" }); },
    charge(id: string) { return request<ChargeDetail>(`charges/${id}`); },
    startProofUpload(id: string, input: ProofUploadInput) { return request<ProofUploadTicket>(`charges/${id}/proof`, { method: "POST", body: JSON.stringify(input) }); },
    completeProofUpload(id: string) { return request<ChargeDetail>(`charges/${id}/proof/complete`, { method: "POST" }, "Não foi possível confirmar o envio."); },
    reviewProof(id: string, decision: "accepted" | "rejected", reason?: string) { return request<ChargeDetail>(`charges/${id}/proof/review`, { method: "POST", body: JSON.stringify({ decision, reason }) }); },
    withdrawProof(id: string) { return request<void>(`charges/${id}/proof`, { method: "DELETE" }, "Não foi possível apagar o comprovante."); },
    declarePayment(id: string) { return request<ChargeDetail>(`charges/${id}/proof/declaration`, { method: "POST" }, "Não foi possível informar o pagamento."); },
    silenceCharge(id: string, silenced: boolean) {
      return request<ChargeDetail>(`charges/${id}/silenced`, { method: "PUT", body: JSON.stringify({ silenced }) }, "Não foi possível atualizar os avisos.");
    },
    downloadProof(id: string) { return request<{ url: string; expiresIn: number }>(`charges/${id}/proof/download`); },
    cancel(id: string) { return request<ChargeDetail>(`charges/${id}/cancel`, { method: "POST" }); },
    reopen(id: string) { return request<ChargeDetail>(`charges/${id}/reopen`, { method: "POST" }, "Não foi possível reabrir a cobrança."); },
    pay(id: string) { return request<ChargeDetail>(`charges/${id}/pay`, { method: "POST" }); },
    publicLink(id: string, rotate = false, paymentMethodId?: string) { return request<PublicLink>(`charges/${id}/public-link${rotate ? "/rotate" : ""}`, { method: "POST", ...(paymentMethodId ? { body: JSON.stringify({ paymentMethodId }) } : {}) }); },
    revokePublicLink(id: string) { return request<void>(`charges/${id}/public-link`, { method: "DELETE" }); },
    ledger(id: string, cursor?: string) { return request<ContactLedger>(`contacts/${id}/ledger${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`); },
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
