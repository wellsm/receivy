import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist", "src/route-tree.gen.ts", "coverage"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    rules: {
      // Every `if`/`else`/loop body in braces, and a blank line whenever the statement kind changes
      // (a `const` after an `if`, an `await` after a `const`); statements of one kind stay together.
      curly: ["error", "all"],
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: ["if", "for", "while", "do", "switch", "try", "return", "throw", "function", "class", "block-like"] },
        { blankLine: "always", prev: ["if", "for", "while", "do", "switch", "try", "function", "class", "block-like"], next: "*" },
        { blankLine: "always", prev: "*", next: ["const", "let", "var"] },
        { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
        { blankLine: "any", prev: ["const", "let", "var"], next: ["const", "let", "var"] },
        { blankLine: "always", prev: "*", next: "expression" },
        { blankLine: "always", prev: "expression", next: "*" },
        { blankLine: "any", prev: "expression", next: "expression" },
        { blankLine: "any", prev: "if", next: "if" },
        { blankLine: "any", prev: "block-like", next: "block-like" },
        { blankLine: "any", prev: "import", next: "import" },
        { blankLine: "any", prev: "export", next: "export" },
      ],
    },
  },
  {
    // Route files export `Route`: Fast Refresh warnings are noise there.
    files: ["src/routes/**/*.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // These components intentionally colocate a small helper or a lookup table with the
    // component that uses it (`initialOf`, `shortDate`, `PIX_TYPE_LABELS`): Fast Refresh
    // warnings are noise here too.
    files: ["src/components/ui/**/*.tsx", "src/components/app/**/*.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
]);
