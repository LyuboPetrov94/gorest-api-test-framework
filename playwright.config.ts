import { defineConfig } from "@playwright/test";
import type { ReporterDescription } from "@playwright/test";
import * as dotenv from "dotenv";

// Load GOREST_TOKEN from .env at config load time. .env is gitignored;
// .env.example is committed. See CLAUDE.md for token acquisition steps.
dotenv.config({ quiet: true });

// Reporters. "list" prints one line per test to the console (CI step log +
// local runs) - every test is visible without opening the report. "html" is
// the structured, browsable report uploaded as a CI artifact on every run. On
// CI we also emit a JSON results file that the workflow turns into a per-run
// summary table (see the "Test summary" step in .github/workflows/ci.yml).
const reporter: ReporterDescription[] = [["list"], ["html", { open: "never" }]];
if (process.env.CI) {
  reporter.push(["json", { outputFile: "results.json" }]);
}

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
