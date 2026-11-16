import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: process.env["LITTORA_URL"]
    ? undefined
    : {
        command: "npm exec -- ng serve --host 127.0.0.1 --port 4300",
        url: "http://127.0.0.1:4300",
        reuseExistingServer: false,
        timeout: 120000,
      },
  use: {
    baseURL: process.env["LITTORA_URL"] || "http://127.0.0.1:4300",
    channel: process.env["PLAYWRIGHT_CHANNEL"] || undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "small-mobile", use: { viewport: { width: 360, height: 800 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
    { name: "wide", use: { viewport: { width: 1920, height: 1080 } } },
  ],
});
