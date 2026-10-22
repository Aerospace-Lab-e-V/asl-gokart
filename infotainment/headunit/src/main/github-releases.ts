import https from "https";
import log from "electron-log/main";

/*
 * The repo's GitHub release list, fetched once and shared by the app updater and the ECU Manager.
 * Anonymous API calls are limited to 60/h per IP, so concurrent callers share one request.
 */

const GITHUB_REPO = "Aerospace-Lab-e-V/asl-gokart";
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface GitHubRelease {
    tag_name: string;
    name: string;
    prerelease: boolean;
    published_at: string;
    assets: {
        name: string;
        size: number;
        browser_download_url: string;
    }[];
}

let cache: { releases: GitHubRelease[]; fetchedAt: number } | null = null;
let inFlight: Promise<GitHubRelease[]> | null = null;

function fetchJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const req = https.get(
            url,
            {
                headers: {
                    "User-Agent": "asl-gokart-headunit",
                    "Accept": "application/vnd.github+json",
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () => {
                    try {
                        const body = Buffer.concat(chunks).toString("utf-8");
                        const status = res.statusCode ?? 0;
                        if (status < 200 || status >= 300) {
                            // e.g. 403 when the anonymous rate limit (60/h) is used up
                            reject(new Error(`GitHub API returned HTTP ${status}: ${body.slice(0, 200)}`));
                            return;
                        }
                        resolve(JSON.parse(body) as T);
                    } catch (err) {
                        reject(err);
                    }
                });
            }
        );
        req.on("error", reject);
        req.setTimeout(10_000, () => {
            req.destroy();
            reject(new Error("GitHub API request timed out"));
        });
    });
}

export function fetchGitHubReleases(): Promise<GitHubRelease[]> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        log.debug("[github-releases] Returning cached release list");
        return Promise.resolve(cache.releases);
    }
    if (inFlight) return inFlight;

    log.info("[github-releases] Fetching releases from GitHub");
    inFlight = fetchJson<GitHubRelease[]>(`https://api.github.com/repos/${GITHUB_REPO}/releases`)
        .then((releases) => {
            if (!Array.isArray(releases)) throw new Error("GitHub API returned no release list");
            // GitHub's edge sometimes serves a stale empty list; don't pin that for the whole TTL
            if (releases.length > 0) cache = { releases, fetchedAt: Date.now() };
            log.info(`[github-releases] Fetched ${releases.length} release(s)`);
            return releases;
        })
        .finally(() => {
            inFlight = null;
        });
    return inFlight;
}
