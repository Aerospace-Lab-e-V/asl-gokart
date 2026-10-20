import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDeb } from "@electron-forge/maker-deb";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { bundleKartAgent } from "./packaging/kart-agent";

const config: ForgeConfig = {
    hooks: {
        packageAfterExtract: async (_config, buildPath, _electronVersion, _platform, arch) =>
            bundleKartAgent(buildPath, arch),
    },
    packagerConfig: {
        asar: {
            unpack: "**/*.node",
        },
        // prune removes devDependencies from the packaged node_modules copy,
        // which is what keeps the artifact size manageable when we include the
        // full node_modules below.
        prune: true,
        // The Vite plugin's default ignore strips everything except .vite/,
        // but main-process externals (sero-node, electron-log
        // and their transitive deps) must be present in node_modules at runtime.
        ignore: (file: string) => {
            if (!file) return false;
            if (file.startsWith("/.vite")) return false;
            if (file === "/package.json") return false;
            if (file.startsWith("/node_modules")) return false;

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
