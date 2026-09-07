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
    ignores: ["src/components/safe-area-view.tsx"],
    rules: {
      // Uniwind ignores `className` on third-party components; the wrapped
      // SafeAreaView in @/components/safe-area-view is the only supported one.
      "no-restricted-imports": ["error", {
        paths: [{
          name: "react-native-safe-area-context",
          importNames: ["SafeAreaView"],
          message: "Import SafeAreaView from \"@/components/safe-area-view\" so uniwind className styles apply on native.",
        }],
      }],
    },
  },
]);
