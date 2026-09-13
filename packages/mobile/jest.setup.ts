/** Uniwind resolves CSS variables at runtime on device; tests read the light palette so snapshots and colors stay stable. */
const LIGHT: Record<string, string> = {
  "--color-canvas": "#faf8ff",
  "--color-surface": "#ffffff",
  "--color-primary": "#0b513d",
  "--color-primary-strong": "#003828",
  "--color-on-primary": "#ffffff",
  "--color-ink": "#131b2e",
  "--color-muted": "#566070",
  "--color-outline": "#bfc9c3",
  "--color-danger": "#b91c1c",
  "--color-warning": "#78350f",
  "--color-info": "#1e40af",
  "--color-success": "#065f46",
};

jest.mock("uniwind", () => ({
  ...jest.requireActual("uniwind"),
  Uniwind: { setTheme: jest.fn() },
  useCSSVariable: (names: string | string[]) => (Array.isArray(names) ? names.map((name) => LIGHT[name]) : LIGHT[names]),
  useUniwind: () => ({ theme: "light", hasAdaptiveThemes: true }),
}));

jest.mock("expo-secure-store", () => {
  const values = new Map<string, string>();

  return {
    getItem: jest.fn((key: string) => values.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => void values.set(key, value)),
    getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void values.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void values.delete(key)),
  };
});
