import { defineConfig } from "@playwright/test";
import * as dotenv from "dotenv";

// Load GOREST_TOKEN from .env at config load time. .env is gitignored;
// .env.example is committed. See CLAUDE.md for token acquisition steps.
dotenv.config();

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,

  // Workers reduced from the prior project's 4 to stay under GoRest's
  // 90-req/min default rate limit per token. If your token has a raised
  // limit, increase here. Hitting 429s in green tests? Lower further.
  workers: process.env.CI ? 1 : 2,

  reporter: [["html", { open: "never" }]],

  use: {
    // Origin only — services carry the full `/public/v2/<resource>` path.
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
