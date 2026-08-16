import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
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
      "jsx-a11y": jsxA11y,
    },
    settings: {
      // Without this, jsx-a11y/label-has-associated-control only sees the
      // 46 native <label> tags in the codebase and silently ignores all
      // ~430 uses of the shadcn <Label> wrapper (src/components/ui/label.tsx,
      // which renders @radix-ui/react-label -> a real <label> under the
      // hood) -- i.e. it would miss almost the entire problem this rule
      // was added to catch.
      "jsx-a11y": { components: { Label: "label" } },
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
      // Added 2026-08-17 after an audit found 431 shadcn <Label> uses vs.
      // only 15 wired to their control via htmlFor/id -- most fields were
      // reaching screen readers as an unnamed "edit text". Auth.tsx (the
      // first screen every user hits) is fixed as of this commit; the
      // remaining count below is pre-existing debt in other forms, tracked
      // the same way as no-explicit-any: a shrinking budget, not a license
      // to add more. Scoped to this one rule rather than jsx-a11y's full
      // recommended config, which would add several unreviewed rules and
      // an unknown warning count in the same PR as an unrelated fix.
      "jsx-a11y/label-has-associated-control": "warn",
    },
  },
);
