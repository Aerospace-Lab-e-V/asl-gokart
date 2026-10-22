import log from 'electron-log/main';
import { FirmwareRelease } from '@/data/ecu/ecu-types';
import { fetchGitHubReleases } from '@/main/github-releases';

export async function fetchReleases(assetName: string): Promise<FirmwareRelease[]> {
    const releases: FirmwareRelease[] = (await fetchGitHubReleases())
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

    log.debug(`[github-releases] Found ${releases.length} release(s) for ${assetName}`);
    return releases;
}

/** The release to download for `tag`, from the GitHub list (never a URL from the renderer). */
export async function resolveFirmwareRelease(assetName: string, tag: string): Promise<FirmwareRelease> {
    const release = (await fetchReleases(assetName)).find((r) => r.tag === tag);
    if (!release) throw new Error(`Release ${tag} of ${assetName} not found`);
    return release;
}
