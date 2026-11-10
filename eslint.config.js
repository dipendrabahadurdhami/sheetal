import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// The three APIs and their shared core, plus the new server-side folders (platform, and each app's backend/ and src/).
const API = [
  "backend-core/**", "website/backend/**", "business/backend/**", "admin/backend/**", "mail-server/**",
  "platform/**", "apps/**/backend/**", "apps/**/src/**",
];
// Single TypeScript files that sit outside those folders (the manifest of each app).
const TS_FILES = ["apps/*/app.manifest.ts"];

export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "backend-core/.pgdata/**", ".foundation-*-backup/**", "foundation-1*/**"] },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    ignores: [...API, ...TS_FILES],
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
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: [...API.map((d) => `${d}/*.ts`), ...TS_FILES] })),
  {
    files: [...API.map((d) => `${d}/*.ts`), ...TS_FILES],
    rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }] },
  },
  { files: [...API.map((d) => `${d}/*.mjs`), "scripts/build-api.mjs"], languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node } }, rules: js.configs.recommended.rules },
  // Moved files (P1-BE-1): new code in platform/ and apps/ imports the platform package, not the old backend-core paths.
  // backend-core itself is left alone: its own files keep working through the re-export shims.
  {
    files: ["platform/**/*.ts", "apps/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@sheetal/backend-core/lib/errors", "**/backend-core/src/lib/errors", "**/backend-core/src/lib/errors.js"], message: "Moved: use @sheetal/platform/core/errors." },
          { group: ["@sheetal/backend-core/lib/db", "**/backend-core/src/lib/db", "**/backend-core/src/lib/db.js"], message: "Moved: use @sheetal/platform/db/client." },
          { group: ["@sheetal/backend-core/config", "**/backend-core/src/config", "**/backend-core/src/config.js"], message: "Moved: use @sheetal/platform/core/config." },
          { group: ["@sheetal/backend-core/lib/vault", "**/backend-core/src/lib/vault", "**/backend-core/src/lib/vault.js"], message: "Moved: use @sheetal/platform/auth/vault." },
          { group: ["@sheetal/backend-core/lib/secrets", "**/backend-core/src/lib/secrets", "**/backend-core/src/lib/secrets.js"], message: "Moved: use @sheetal/platform/auth/secrets." },
        ],
      }],
    },
  },
];
