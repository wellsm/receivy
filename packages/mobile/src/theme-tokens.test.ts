// The mobile package has no @types/node. `require` is already declared globally by Expo's
// Metro types (expo/types/metro-require.d.ts), so these Node built-ins are pulled in through
// it with local shapes instead of adding a devDependency just for this one guard test.
declare const __dirname: string;

const { readdirSync, readFileSync, statSync }: {
  readdirSync: (path: string) => string[];
  readFileSync: (path: string, encoding: "utf8") => string;
  statSync: (path: string) => { isDirectory(): boolean };
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- no @types/node to back an ES import here
} = require("node:fs");

const { join, relative }: {
  join: (...parts: string[]) => string;
  relative: (from: string, to: string) => string;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- no @types/node to back an ES import here
} = require("node:path");

/**
 * Every color on screen comes from a token with a light and a dark variant (global.css) or from useThemeColors().
 * A fixed palette class or a hex literal renders the same in both themes, so it breaks dark mode silently.
 */
const ROOT = __dirname;
const PALETTE =
  /\b(?:bg|text|border|border-[xytrbl]|ring|fill|stroke|divide|placeholder|outline|decoration|accent|caret)-(?:white|black|red|amber|blue|green|emerald|gray|slate|zinc|neutral|yellow|orange|sky|rose|violet|purple|indigo|pink|fuchsia|teal|cyan|lime)(?:-\d{2,3})?(?:\/\d{1,3})?\b/;
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/;

function sources(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      sources(path, found);
      continue;
    }

    if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
      found.push(path);
    }
  }

  return found;
}

it("keeps fixed palette colors and hex literals out of components", () => {
  const files = sources(ROOT);

  expect(files.length).toBeGreaterThan(20);

  const offenders = files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) => (PALETTE.test(line) || HEX.test(line) ? [`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`] : [])),
  );

  expect(offenders).toEqual([]);
});
