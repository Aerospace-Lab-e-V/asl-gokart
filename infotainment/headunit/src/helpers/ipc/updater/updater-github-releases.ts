import * as https from 'https';
import * as path from 'path';
import log from 'electron-log/main';
import { AppRelease } from '@/data/updater/updater-types';

const GITHUB_REPO = 'Aerospace-Lab-e-V/asl-gokart';
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
    releases: AppRelease[];
    fetchedAt: number;
}

let releaseCache: CacheEntry | null = null;

interface GitHubRelease {
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

export function getDebArch(): string {
    return process.arch === 'arm64' ? 'arm64' : 'amd64';
}

export function debAssetName(tag: string): string {
    const version = tag.startsWith('v') ? tag.slice(1) : tag;
    return `headunit_${version}_${getDebArch()}.deb`;
}

export async function fetchAppReleases(): Promise<AppRelease[]> {
    if (releaseCache && Date.now() - releaseCache.fetchedAt < CACHE_TTL_MS) {
        log.debug('[updater-github-releases] Returning cached release list');
        return releaseCache.releases;
    }

    const arch = getDebArch();
    log.info(`[updater-github-releases] Fetching releases from GitHub (arch: ${arch})`);

    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
    const ghReleases = await fetchJson<GitHubRelease[]>(url);

    const releases: AppRelease[] = ghReleases
        .map((r): AppRelease | null => {
            const expectedName = debAssetName(r.tag_name);
            const asset = r.assets.find((a) => a.name === expectedName);
            if (!asset) return null;
            return {
                tag: r.tag_name,
                version: r.tag_name.startsWith('v') ? r.tag_name.slice(1) : r.tag_name,
                publishedAt: r.published_at,
                downloadUrl: asset.browser_download_url,
                assetName: asset.name,
                assetSize: asset.size,
                isPrerelease: r.prerelease,
            };
        })
        .filter((r): r is AppRelease => r !== null);

    releaseCache = { releases, fetchedAt: Date.now() };
    log.info(`[updater-github-releases] Found ${releases.length} release(s) for arch ${arch}`);
    return releases;
}

/**
 * The release to install for `tag`, from the GitHub list (never from the renderer). Its asset name
 * becomes a file name, so it must be exactly the expected .deb name with no path in it.
 */
export async function resolveAppRelease(tag: string): Promise<AppRelease> {
    const release = (await fetchAppReleases()).find((r) => r.tag === tag);
    if (!release) throw new Error(`Release ${tag} not found`);
    const { assetName } = release;
    if (assetName !== debAssetName(release.tag) || path.basename(assetName) !== assetName || assetName.includes('\\')) {
        throw new Error(`Refusing unexpected asset name: ${assetName}`);
    }
    return release;
}

export function invalidateAppReleaseCache(): void {
    releaseCache = null;
}
