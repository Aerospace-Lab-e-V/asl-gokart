import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDeb } from "@electron-forge/maker-deb";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import fs from "node:fs";
import path from "node:path";
import { bundleKartAgent } from "./packaging/kart-agent";

/** Chromium UI locales to keep, it falls back to en-US for the rest. Saves ~37 MB. */
const LOCALES = new Set(["en-US.pak", "de.pak"]);

async function pruneLocales(buildPath: string): Promise<void> {
    const dir = path.join(buildPath, "locales");
    for (const file of await fs.promises.readdir(dir)) {
        if (!LOCALES.has(file)) await fs.promises.rm(path.join(dir, file));
    }
}

const config: ForgeConfig = {
    hooks: {
        packageAfterExtract: async (_config, buildPath, _electronVersion, _platform, arch) => {
            await bundleKartAgent(buildPath, arch);
            await pruneLocales(buildPath);
        },
    },
    packagerConfig: {
        asar: {
            unpack: "**/*.node",
        },
        prune: true,
        // Vite bundles everything except the native sero-node addon (see vite.main.config.ts),
        // so that is the only node_modules entry shipped. It has no runtime dependencies.
        ignore: (file: string) => {
            if (!file) return false;
            if (file.startsWith("/.vite")) return false;
            if (file === "/package.json") return false;
            if (file === "/node_modules" || file === "/node_modules/@asl-gokart") return false;
            if (file.startsWith("/node_modules/@asl-gokart/sero-node")) return false;

            return true;
        },
    },
    rebuildConfig: {},
    makers: [
        new MakerDeb({
            options: {
                // Enable and restart the bundled kart-agent service.
                scripts: {
                    postinst: "packaging/deb/postinst",
                    prerm: "packaging/deb/prerm",
                    postrm: "packaging/deb/postrm",
                },
            },
        }),
    ],
    plugins: [
        new VitePlugin({
            // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
            // If you are familiar with Vite configuration, it will look really familiar.
            build: [
                {
                    // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
                    entry: "src/main.ts",
                    config: "vite.main.config.ts",
                },
                {
                    entry: "src/preload.ts",
                    config: "vite.preload.config.ts",
                },
            ],
            renderer: [
                {
                    name: "main_window",
                    config: "vite.renderer.config.ts",
                },
            ],
        }),
        // Fuses are used to enable/disable various Electron functionality
        // at package time, before code signing the application
        new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
        }),
    ],
};

export default config;
