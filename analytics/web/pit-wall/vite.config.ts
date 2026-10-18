import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Dev: proxy the same paths Caddy serves in the container, so the app is always
// same-origin (no CORS, and `wss://` + Keycloak later work the same way).
//   /api  → pit-api   (cargo run -p pit-api)
//   /mqtt → Mosquitto MQTT-over-WebSocket listener (dev compose stack)
export default defineConfig({
    plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
    server: {
        port: 5173,
        proxy: {
            "/api": "http://localhost:8081",
            "/mqtt": { target: "ws://localhost:9001", ws: true },
        },
    },
    test: {
        include: ["src/**/*.test.ts"],
    },
});
