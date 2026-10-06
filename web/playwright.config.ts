import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120000,
  use: {
    baseURL: "http://localhost:3102",
    channel: "chrome",
    launchOptions: { args: ["--no-sandbox"] },
  },
  webServer: {
    command: "bun run start -- --port 3102",
    port: 3102,
    reuseExistingServer: true,
    stdout: "pipe",
  },
});
