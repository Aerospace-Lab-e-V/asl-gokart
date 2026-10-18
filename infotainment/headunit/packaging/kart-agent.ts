import fs from "node:fs";
import path from "node:path";

/**
 * kart-agent (analytics/crates/kart-agent) ships inside the headunit package as a
 * systemd service, see analytics/docs/adr/0001-kart-agent-integration.md.
 */

/** Rust target per Electron arch. armv7l (ODROID) has no agent build. */
const TARGETS: Record<string, { triple: string; elfMachine: number }> = {
    x64: { triple: "x86_64-unknown-linux-gnu", elfMachine: 0x3e },
    arm64: { triple: "aarch64-unknown-linux-gnu", elfMachine: 0xb7 },
};

const ANALYTICS = path.resolve(__dirname, "../../../analytics");
const DIST_FILES = ["kart-agent.service", "agent.toml.example"];

/**
 * Forge `packageAfterExtract` hook: copies the agent binary, its systemd unit and the
 * example config to `resources/kart-agent/`, where the deb's postinst expects them.
 *
 * The binary comes from `KART_AGENT_BIN` (CI) or the local cargo-zigbuild output.
 * Set `KART_AGENT_OPTIONAL=1` to package without it.
 */
export async function bundleKartAgent(buildPath: string, arch: string): Promise<void> {
    const target = TARGETS[arch];
    if (!target) {
        console.warn(`kart-agent: no build for ${arch}, packaging without it`);
        return;
    }
    const bin =
        process.env.KART_AGENT_BIN ??
        path.join(ANALYTICS, "target", target.triple, "dist", "kart-agent");
    if (!fs.existsSync(bin)) {
        const message =
            `kart-agent binary not found at ${bin}. In analytics/, run ` +
            `"cargo zigbuild --profile dist -p kart-agent --target ${target.triple}.2.31", ` +
            `set KART_AGENT_BIN, or set KART_AGENT_OPTIONAL=1 to package without the agent.`;
        if (process.env.KART_AGENT_OPTIONAL === "1") {
            console.warn(message);
            return;
        }
        throw new Error(message);
    }
    // A binary for the wrong architecture would only fail on the kart.
    const header = Buffer.alloc(20);
    const fd = await fs.promises.open(bin, "r");
    await fd.read(header, 0, header.length, 0);
    await fd.close();
    if (header.readUInt32BE(0) !== 0x7f454c46 || header.readUInt16LE(18) !== target.elfMachine) {
        throw new Error(`${bin} is not a ${arch} Linux executable`);
    }

    const dest = path.join(buildPath, "resources", "kart-agent");
    await fs.promises.mkdir(dest, { recursive: true });
    await fs.promises.copyFile(bin, path.join(dest, "kart-agent"));
    await fs.promises.chmod(path.join(dest, "kart-agent"), 0o755);
    for (const file of DIST_FILES) {
        await fs.promises.copyFile(
            path.join(ANALYTICS, "crates", "kart-agent", "dist", file),
            path.join(dest, file)
        );
    }
}
