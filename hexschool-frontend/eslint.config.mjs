import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright output (traces, videos, HTML report, saved auth states).
    "test-results/**",
    "playwright-report/**",
    "e2e/.auth/**",
  ]),
  {
    // The Playwright suite is Node, not React. Its fixtures take a callback
    // named `use` — Playwright's parameter-injection API, nothing to do with
    // React's `use` hook — which the react-hooks rules flag as a hook called
    // outside a component.
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
]);

export default eslintConfig;
