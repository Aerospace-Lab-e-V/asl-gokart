import https from 'https';
import log from 'electron-log/main';
import { FirmwareRelease } from '@/data/ecu/ecu-types';

const GITHUB_REPO = 'Aerospace-Lab-e-V/asl-gokart';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
    releases: FirmwareRelease[];
    fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

function fetchJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const req = https.get(
            url,
            {
                headers: {
                    'User-Agent': 'asl-gokart-headunit',
                    'Accept': 'application/vnd.github+json',
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    try {
                        const body = Buffer.concat(chunks).toString('utf-8');
                        resolve(JSON.parse(body) as T);
                    } catch (err) {
                        reject(err);
                    }
                });
            }
        );
        req.on('error', reject);
        req.setTimeout(10_000, () => {
            req.destroy();
            reject(new Error('GitHub API request timed out'));
        });
    });
}

interface GitHubRelease {
    tag_name: string;
    name: string;
    prerelease: boolean;
    published_at: string;
    assets: {
        name: string;
        browser_download_url: string;
    }[];
}

export async function fetchReleases(assetName: string): Promise<FirmwareRelease[]> {
    const cached = cache.get(assetName);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        log.debug(`[github-releases] Returning cached releases for ${assetName}`);
        return cached.releases;
    }

    log.info(`[github-releases] Fetching releases from GitHub for asset: ${assetName}`);

    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
    const ghReleases = await fetchJson<GitHubRelease[]>(url);

    const releases: FirmwareRelease[] = ghReleases
        .filter((r) => r.assets.some((a) => a.name === assetName))
        .map((r) => {
            const asset = r.assets.find((a) => a.name === assetName)!;
            return {
                tag: r.tag_name,
                version: r.tag_name,
                publishedAt: r.published_at,
                downloadUrl: asset.browser_download_url,
                isPrerelease: r.prerelease,
            };
        });

    cache.set(assetName, { releases, fetchedAt: Date.now() });
    log.info(`[github-releases] Found ${releases.length} release(s) for ${assetName}`);
    return releases;
}

export function invalidateCache(): void {
    cache.clear();
}
