import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// The three APIs and their shared core.
const API = ["backend-core/**", "website/backend/**", "business/backend/**", "admin/backend/**", "mail-server/**"];

export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "backend-core/.pgdata/**", ".foundation-*-backup/**", "foundation-1*/**"] },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    ignores: API,
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.browser, ...globals.node }, parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: "18.3" } },
    plugins: { react, "react-hooks": reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off",
      "react/prop-types": "off",
      "react/display-name": "off",
      "react/no-unescaped-entities": "off",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", ignoreRestSiblings: true, varsIgnorePattern: "^(_|React$)" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  // APIs: TypeScript rules (strict types are also checked by tsc).
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: API.map((d) => `${d}/*.ts`) })),
  {
    files: API.map((d) => `${d}/*.ts`),
    rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }] },
  },
  { files: [...API.map((d) => `${d}/*.mjs`), "scripts/build-api.mjs"], languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node } }, rules: js.configs.recommended.rules },
];
