/* Formatting and comparing GitHub release tags (vX.Y.Z), shared by App update and the ECU Manager. */

export const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });

/** Compares major, minor and patch; a pre-release suffix such as "-rc1" is ignored. */
export const semverCompare = (a: string, b: string): number => {
    const parse = (v: string) =>
        v
            .replace(/^v/, "")
            .split(/[.-]/)
            .slice(0, 3)
            .map((n) => parseInt(n, 10) || 0);
    const [aMaj, aMin, aPat] = parse(a);
    const [bMaj, bMin, bPat] = parse(b);
    return aMaj !== bMaj ? aMaj - bMaj : aMin !== bMin ? aMin - bMin : aPat - bPat;
};
