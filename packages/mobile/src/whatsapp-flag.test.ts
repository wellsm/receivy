import { PlanTier, WhatsappInstanceState, WhatsappSender, type WhatsappInstanceView, type WhatsappSettings } from "@receivy/common";
import { whatsappSubtitle } from "@/whatsapp-flag";

const receivy: WhatsappSettings = { available: true, sender: WhatsappSender.Receivy, instance: null, quota: { used: 37, limit: 150, cycleEnd: null } };

function own(state: WhatsappInstanceState): WhatsappSettings {
  const instance: WhatsappInstanceView = { state, phone: "5511988887777", qr: null, pairingCode: null, connectedAt: null, disconnectedAt: null };

  return { ...receivy, sender: WhatsappSender.Own, instance };
}

describe("whatsappSubtitle", () => {
  it.each<[string, WhatsappSettings | null, PlanTier | null, string]>([
    ["not loaded", null, PlanTier.Basic, "Em breve"],
    ["unavailable", { ...receivy, available: false }, PlanTier.Basic, "Em breve"],
    ["free plan", receivy, PlanTier.Free, "Disponível no plano Básico"],
    ["receivy number", receivy, PlanTier.Basic, "Pelo número do Receivy · 37 de 150 neste ciclo"],
    ["own open", own(WhatsappInstanceState.Open), PlanTier.Basic, "Pelo seu número · conectado"],
    ["own pending", own(WhatsappInstanceState.Pending), PlanTier.Basic, "Pelo seu número · aguardando pareamento"],
    ["own closed", own(WhatsappInstanceState.Closed), PlanTier.Basic, "Seu número desconectou"],
  ])("%s", (_name, settings, plan, expected) => {
    expect(whatsappSubtitle(settings, plan)).toBe(expected);
  });
});
