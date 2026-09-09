/**
 * Web has no native stack, so every sub screen spells out where its back link
 * goes. The map keeps those labels in one place — the same wording the bottom
 * navigation and the form headers already use.
 */
const BACK_LABELS: Record<string, string> = {
  "/": "Feed",
  "/billings": "Cobranças",
  "/charges/new": "Nova cobrança",
  "/people": "Contatos",
  "/settings": "Perfil",
};

const FALLBACK_LABEL = "Voltar";

/** Name of the screen `path` returns to, or `Voltar` when the route is not a known destination. */
export function backLabelFor(path: string): string {
  const [route = ""] = path.split(/[?#]/);

  if (!route) {
    return FALLBACK_LABEL;
  }

  const normalized = route.length > 1 ? route.replace(/\/+$/, "") : route;

  return BACK_LABELS[normalized] ?? FALLBACK_LABEL;
}
