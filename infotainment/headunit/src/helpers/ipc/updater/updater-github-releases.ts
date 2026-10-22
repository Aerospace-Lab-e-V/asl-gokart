import * as path from 'path';
import log from 'electron-log/main';
import { AppRelease } from '@/data/updater/updater-types';
import { fetchGitHubReleases } from '@/main/github-releases';

export function getDebArch(): string {
    return process.arch === 'arm64' ? 'arm64' : 'amd64';
}

export function debAssetName(tag: string): string {
    const version = tag.startsWith('v') ? tag.slice(1) : tag;
    return `headunit_${version}_${getDebArch()}.deb`;
}

export async function fetchAppReleases(): Promise<AppRelease[]> {
    const arch = getDebArch();
    const releases: AppRelease[] = (await fetchGitHubReleases())
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

    log.debug(`[updater-github-releases] Found ${releases.length} release(s) for arch ${arch}`);
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
