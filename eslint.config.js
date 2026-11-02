import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "backend/.pgdata/**"] },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    ignores: ["backend/**"],
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
  // Backend: TypeScript rules (strict types are also checked by tsc).
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["backend/**/*.ts"] })),
  {
    files: ["backend/**/*.ts"],
    rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }] },
  },
  { files: ["backend/**/*.mjs"], languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node } }, rules: js.configs.recommended.rules },
];
