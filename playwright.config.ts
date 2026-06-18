import { defineConfig } from "@playwright/test";
import type { ReporterDescription } from "@playwright/test";
import * as dotenv from "dotenv";

// Load GOREST_TOKEN_MAIN / GOREST_TOKEN_SUB from .env at config load time. .env is gitignored;
// .env.example is committed. See CLAUDE.md for token acquisition steps.
dotenv.config({ quiet: true });

// Reporters. "list" prints one line per test to the console (CI step log +
// local runs) - every test is visible without opening the report.
//
// On CI the suite is split across three jobs that each run a different slice
// (default / @isolation / @ratelimit), so each emits a "blob" report under a
// unique filename (PW_BLOB_NAME). The `merge-report` job in
// .github/workflows/ci.yml combines all the blobs into ONE HTML report covering
// every test, which `deploy-report` publishes to GitHub Pages. "json"
// (results.json) still feeds the per-run summary table (the "Test summary"
// step). Locally we just want the browsable "html" report.
const reporter: ReporterDescription[] = process.env.CI
  ? [
      ["list"],
      ["blob", { fileName: `${process.env.PW_BLOB_NAME || "report"}.zip` }],
      ["json", { outputFile: "results.json" }],
    ]
  : [["list"], ["html", { open: "never" }]];

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,

  // Workers reduced from the prior project's 4 to stay under GoRest's
  // 300-req/min default rate limit per token (a ~5 req/sec refilling token
  // bucket - steady traffic rarely depletes it, bursts can). If your token
  // has a raised limit, increase here. Hitting 429s in green tests? Lower further.
  workers: process.env.CI ? 1 : 2,

  reporter,

  use: {
    // Origin only - services carry the full `/public/v2/<resource>` path.
    // See fixtures/index.ts for the WHATWG URL resolution gotcha that forced
    // this convention.
    baseURL: process.env.BASE_URL || "https://gorest.co.in",
  },

  projects: [
    {
      name: "api",
      testDir: "./tests/api",
    },
  ],
});
