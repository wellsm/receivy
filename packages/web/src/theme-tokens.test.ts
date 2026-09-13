// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/**
 * Every color on screen comes from a token with a light and a dark value (globals.css). A fixed palette class
 * or an arbitrary hex renders the same in both themes, so it breaks dark mode silently.
 */
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const EXCEPTIONS = new Set(["components/app/brand-marks.tsx"]);
const PALETTE =
  /\b(?:bg|text|border|border-[xytrbl]|ring|fill|stroke|divide|placeholder|outline|decoration|accent|caret)-(?:white|black|red|amber|blue|green|emerald|gray|slate|zinc|neutral|yellow|orange|sky|rose|violet|purple|indigo|pink|fuchsia|teal|cyan|lime)(?:-\d{2,3})?(?:\/\d{1,3})?\b/;
const ARBITRARY_HEX = /-\[#[0-9a-fA-F]{3,8}\]/;

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

it("keeps fixed palette colors out of components", () => {
  const offenders = sources(ROOT)
    .filter(file => !EXCEPTIONS.has(relative(ROOT, file)))
    .flatMap(file =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => (PALETTE.test(line) || ARBITRARY_HEX.test(line) ? [`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`] : [])),
    );

  expect(offenders).toEqual([]);
});
