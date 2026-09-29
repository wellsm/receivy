import type { PlanSummary } from "@receivy/common";
import { apiFetch } from "@/lib/api/client";

/** The plan as the API sees it, or null when it cannot be read: callers fall back to "no restriction shown". */
export async function loadPlanSummary(): Promise<PlanSummary | null> {
  try {
    const response = await apiFetch("plan");

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as PlanSummary;
  } catch {
    return null;
  }
}
