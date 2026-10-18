import { defineConfig, devices } from "@playwright/test";

// Smoke test against a running stack with kart-sim (not started here):
//   docker compose -f deploy/compose/compose.yml -f deploy/compose/compose.dev.yml --profile sim up --build
//   bun run test:e2e                       # pit wall container on :8080
//   PIT_WALL_URL=http://localhost:5173 bun run test:e2e   # against `bun run dev`
export default defineConfig({
    testDir: "e2e",
    timeout: 30_000,
    use: {
        baseURL: process.env.PIT_WALL_URL ?? "http://localhost:8080",
        trace: "retain-on-failure",
    },
    projects: [
        { name: "desktop", use: { ...devices["Desktop Chrome"] } },
        { name: "phone", use: { ...devices["Pixel 7"] } },
    ],
});
