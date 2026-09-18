// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
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
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/safe-area-view.tsx"],
    rules: {
      // Uniwind ignores `className` on third-party components; the wrapped
      // SafeAreaView in @/components/ui/safe-area-view is the only supported one.
      "no-restricted-imports": ["error", {
        paths: [{
          name: "react-native-safe-area-context",
          importNames: ["SafeAreaView"],
          message: "Import SafeAreaView from \"@/components/ui/safe-area-view\" so uniwind className styles apply on native.",
        }],
      }],
    },
  },
]);
