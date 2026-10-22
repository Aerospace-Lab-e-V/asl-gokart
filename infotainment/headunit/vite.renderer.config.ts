import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import react from "@vitejs/plugin-react";
import type { ConfigEnv, UserConfig } from "vite";
import { defineConfig } from "vite";
import { pluginExposeRenderer } from "./vite.base.config";

/** CI passes the branch, as tag builds run on a detached HEAD. */
function gitBranch(): string {
    if (process.env.HEADUNIT_BUILD_BRANCH) return process.env.HEADUNIT_BUILD_BRANCH;
    try {
        return execSync("git rev-parse --abbrev-ref HEAD", { cwd: __dirname, encoding: "utf-8" }).trim();
    } catch {
        return "unknown";
    }
}

// https://vitejs.dev/config
export default defineConfig((env) => {
    const forgeEnv = env as ConfigEnv<"renderer">;
    const { root, mode, command, forgeConfigSelf } = forgeEnv;
    const name = forgeConfigSelf.name ?? "";

    return {
        root,
        mode,
        base: "./",
        define: {
            HEADUNIT_BUILD_INFO: JSON.stringify({
                version: JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8")).version,
                branch: gitBranch(),
                builtAt: new Date().toISOString(),
                dev: command === "serve",
            }),
        },
        build: {
            outDir: `.vite/renderer/${name}`,
        },
        plugins: [pluginExposeRenderer(name), react()],
        resolve: {
            preserveSymlinks: true,
            alias: {
                "@": path.resolve(__dirname, "./src"),
            },
        },
        clearScreen: false,
    } as UserConfig;
});
