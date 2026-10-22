/* Formatting and comparing GitHub release tags (vX.Y.Z[-pre]), shared by App update and the ECU Manager. */

export const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });

/** True for a pre-release version or tag, e.g. "0.5.0-alpha.1". */
export const isPrerelease = (v: string): boolean => v.includes("-");

/** SemVer precedence: 0.5.0-alpha.2 < 0.5.0-alpha.10 < 0.5.0-beta.1 < 0.5.0. Build metadata is ignored. */
export const semverCompare = (a: string, b: string): number => {
    const parse = (v: string) => {
        const [core, pre] = v.replace(/^v/, "").split("+")[0].split(/-(.*)/s);
        return { core: core.split(".").slice(0, 3).map((n) => parseInt(n, 10) || 0), pre: pre ? pre.split(".") : [] };
    };
    const x = parse(a);
    const y = parse(b);
    for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return (x.core[i] ?? 0) - (y.core[i] ?? 0);
    // A release outranks its pre-releases
    if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
    for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
        const [p, q] = [x.pre[i], y.pre[i]];
        if (p === q) continue;
        const [pn, qn] = [/^\d+$/.test(p), /^\d+$/.test(q)];
        if (pn && qn) return Number(p) - Number(q);
        if (pn !== qn) return pn ? -1 : 1;
        return p < q ? -1 : 1;
    }
    return x.pre.length - y.pre.length;
};

type Release = { tag: string; isPrerelease: boolean };

/** The releases to list: stable ones, pre-releases only when asked, and always the installed one. */
export const visibleReleases = <R extends Release>(releases: R[], current: string | null, showPre: boolean): R[] =>
    releases.filter((r) => !r.isPrerelease || showPre || (current !== null && semverCompare(r.tag, current) === 0));

/** The newest listed release above `current`, or null. */
export const pickUpdate = <R extends Release>(releases: R[], current: string, showPre: boolean): R | null =>
    visibleReleases(releases, current, showPre)
        .filter((r) => semverCompare(r.tag, current) > 0)
        .reduce<R | null>((best, r) => (!best || semverCompare(r.tag, best.tag) > 0 ? r : best), null);

/** The newest stable release below a pre-release `current`: the way back from an alpha. */
export const previousStable = <R extends Release>(releases: R[], current: string | null): R | null =>
    !current || !isPrerelease(current)
        ? null
        : releases
              .filter((r) => !r.isPrerelease && semverCompare(r.tag, current) < 0)
              .reduce<R | null>((best, r) => (!best || semverCompare(r.tag, best.tag) > 0 ? r : best), null);

const SHOW_PRE_KEY = "updater.showPrereleases";

/** Whether the updater lists pre-releases; defaults to on while a pre-release is installed. */
export const getShowPrereleases = (current: string | null): boolean => {
    try {
        const stored = localStorage.getItem(SHOW_PRE_KEY);
        if (stored !== null) return stored === "true";
    } catch {
        // storage unavailable, use the default
    }
    return current !== null && isPrerelease(current);
};

export const setShowPrereleases = (show: boolean): void => {
    try {
        localStorage.setItem(SHOW_PRE_KEY, String(show));
    } catch {
        // storage unavailable, the choice lasts until the page unmounts
    }
};
