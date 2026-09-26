import { PlanTier, WhatsappInstanceState, WhatsappSender, type WhatsappInstanceView, type WhatsappSettings } from "@receivy/common";
import { describe, expect, it } from "vitest";
import { whatsappSubtitle } from "./whatsapp-client";

const receivy: WhatsappSettings = { available: true, ownAvailable: true, sender: WhatsappSender.Receivy, instance: null, quota: { used: 37, limit: 150, cycleEnd: null } };

function own(state: WhatsappInstanceState): WhatsappSettings {
  const instance: WhatsappInstanceView = { state, phone: "5511988887777", qr: null, pairingCode: null, connectedAt: null, disconnectedAt: null };

  return { ...receivy, sender: WhatsappSender.Own, instance };
}

const both = { receivy: true, evolution: true };

describe("whatsappSubtitle", () => {
  it.each<[string, WhatsappSettings | null, PlanTier | null, { receivy: boolean; evolution: boolean }, string]>([
    ["not loaded", null, PlanTier.Basic, both, "Em breve"],
    ["unavailable", { ...receivy, available: false }, PlanTier.Basic, both, "Em breve"],
    ["free plan", receivy, PlanTier.Free, both, "Disponível no plano Básico"],
    ["receivy number", receivy, PlanTier.Basic, both, "Pelo número do Receivy · 37 de 150 neste ciclo"],
    ["own open", own(WhatsappInstanceState.Open), PlanTier.Basic, both, "Pelo seu número · conectado"],
    ["own pending", own(WhatsappInstanceState.Pending), PlanTier.Basic, both, "Pelo seu número · aguardando pareamento"],
    ["own closed", own(WhatsappInstanceState.Closed), PlanTier.Basic, both, "Seu número desconectou"],
    ["receivy only", receivy, PlanTier.Basic, { receivy: true, evolution: false }, "Pelo número do Receivy · 37 de 150 neste ciclo"],
    ["evolution only, no instance", { ...receivy, instance: null }, PlanTier.Basic, { receivy: false, evolution: true }, "Conecte seu número"],
    ["evolution only, open instance", own(WhatsappInstanceState.Open), PlanTier.Basic, { receivy: false, evolution: true }, "Pelo seu número · conectado"],
  ])("%s", (_name, settings, plan, options, expected) => {
    expect(whatsappSubtitle(settings, plan, options)).toBe(expected);
  });
});
