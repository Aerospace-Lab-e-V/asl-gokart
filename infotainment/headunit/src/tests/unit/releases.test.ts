import { pickUpdate, previousStable, semverCompare, visibleReleases } from "@/lib/releases";

test("semver precedence orders pre-releases below their release", () => {
    const ordered = ["0.4.28", "0.5.0-alpha.1", "0.5.0-alpha.2", "0.5.0-alpha.10", "0.5.0-beta.1", "0.5.0-rc.1", "0.5.0", "v0.5.1"];
    for (let i = 1; i < ordered.length; i++) {
        expect(semverCompare(ordered[i - 1], ordered[i])).toBeLessThan(0);
        expect(semverCompare(ordered[i], ordered[i - 1])).toBeGreaterThan(0);
    }
    expect(semverCompare("v0.5.0-alpha.1", "0.5.0-alpha.1")).toBe(0);
    expect(semverCompare("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
    expect(semverCompare("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBeLessThan(0);
});

const rel = (tag: string) => ({ tag, isPrerelease: tag.includes("-") });
const releases = ["v0.5.0-alpha.2", "v0.5.0-alpha.1", "v0.4.28", "v0.4.27"].map(rel);

test("pre-releases are hidden unless asked for or installed", () => {
    expect(visibleReleases(releases, "0.4.28", false).map((r) => r.tag)).toEqual(["v0.4.28", "v0.4.27"]);
    expect(visibleReleases(releases, "0.5.0-alpha.1", false).map((r) => r.tag)).toEqual(["v0.5.0-alpha.1", "v0.4.28", "v0.4.27"]);
    expect(visibleReleases(releases, "0.4.28", true)).toHaveLength(4);
});

test("update and rollback picks", () => {
    expect(pickUpdate(releases, "0.4.27", false)?.tag).toBe("v0.4.28");
    expect(pickUpdate(releases, "0.4.28", false)).toBeNull();
    expect(pickUpdate(releases, "0.4.28", true)?.tag).toBe("v0.5.0-alpha.2");
    expect(previousStable(releases, "0.5.0-alpha.1")?.tag).toBe("v0.4.28");
    expect(previousStable(releases, "0.4.28")).toBeNull();
});
