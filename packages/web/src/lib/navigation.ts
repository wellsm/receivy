/**
 * Web has no native stack, so every sub screen spells out where its back link
 * goes. The map keeps those labels in one place — the same wording the bottom
 * navigation and the form headers already use.
 */
const BACK_LABELS: Record<string, string> = {
  "/": "Feed",
  "/billings": "Contas",
  "/billings/new": "Nova conta",
  "/contacts": "Contatos",
  "/settings": "Perfil",
  "/settings/pix": "Chaves Pix",
};

/** Detail routes carry an id, so they are matched by shape rather than by exact path. */
const BACK_PATTERNS: [RegExp, string][] = [
  [/^\/billings\/[^/]+$/, "Conta"],
  [/^\/charges\/[^/]+$/, "Cobrança"],
  [/^\/contacts\/[^/]+$/, "Contato"],
];

const FALLBACK_LABEL = "Voltar";

/** Name of the screen `path` returns to, or `Voltar` when the route is not a known destination. */
export function backLabelFor(path: string): string {
  const [route = ""] = path.split(/[?#]/);

  if (!route) {
    return FALLBACK_LABEL;
  }

  const normalized = route.length > 1 ? route.replace(/\/+$/, "") : route;

  return BACK_LABELS[normalized] ?? BACK_PATTERNS.find(([pattern]) => pattern.test(normalized))?.[1] ?? FALLBACK_LABEL;
}
