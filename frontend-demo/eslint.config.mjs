import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".next-old-*/**",
    "playwright-report/**",
    "playwright-report-old*/**",
    "pw-results*/**",
    "test-results/**",
    "test-results-old*/**",
  ]),
]);
