import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", "coverage/**", "next-env.d.ts"]),
  {
    files: ["src/**/*.{ts,tsx}"],
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
]);
