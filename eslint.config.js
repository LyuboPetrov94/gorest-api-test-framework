// ESLint flat config (ESLint 10). CommonJS module because package.json declares
// "type": "commonjs". Division of labour: ESLint handles code quality, Prettier
// handles formatting - eslint-config-prettier (kept last) switches off any
// stylistic rules so the two never fight.
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const playwright = require("eslint-plugin-playwright");
const prettier = require("eslint-config-prettier");

module.exports = tseslint.config(
  {
    ignores: [
      "node_modules/",
      "playwright-report/",
      "test-results/",
      "blob-report/",
      "results.json",
    ],
  },
  // Base recommended JS rules - apply everywhere.
  js.configs.recommended,
  // TypeScript recommended rules - scoped to .ts so they do not hit this
  // CommonJS config file (its require() calls are correct here).
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
  },
  // Playwright-specific rules (no test.only left in, valid expect usage, etc.),
  // scoped to the spec files.
  {
    ...playwright.configs["flat/recommended"],
    files: ["tests/**/*.spec.ts"],
    rules: {
      ...playwright.configs["flat/recommended"].rules,
      // This API suite uses conditionals deliberately (cleanup loops,
      // parameterized verb/BVA tables, response branching) - high noise, low
      // signal here. no-conditional-expect stays ON as the assertion-safety
      // guard; its few reviewed-safe sites carry inline disables with reasons.
      "playwright/no-conditional-in-test": "off",
    },
  },
  // Playwright's extend signature requires an empty deps destructure
  // (`async ({}, use) => ...`) and an empty fixtures-type param
  // (`base.extend<{}, WorkerFixtures>`). Both are idiomatic and unavoidable;
  // `Record<string, never>` instead of `{}` makes the worker fixture infer
  // `use` as `never`. Allow both in the fixtures dir only.
  {
    files: ["fixtures/**/*.ts"],
    rules: {
      "no-empty-pattern": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  // This config file is CommonJS - give it the right globals so require/module
  // are not flagged as undefined.
  {
    files: ["**/*.js"],
    languageOptions: { sourceType: "commonjs" },
  },
  // Keep last: disable formatting rules that would conflict with Prettier.
  prettier,
);
