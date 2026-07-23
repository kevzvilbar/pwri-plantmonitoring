import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Pre-existing debt (~1,300 uses as of 2026-07-23), mostly Supabase
      // `.from(table as any)` dynamic-table casts and untyped query results.
      // Downgraded from the recommended-config default of "error" so CI's
      // --max-warnings gate (see ci.yml) can track it as a shrinking budget
      // instead of hard-blocking every PR. New `any` usage should still be
      // avoided — this is a ratchet, not a blanket allowance.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
