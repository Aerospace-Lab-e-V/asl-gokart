import https from "https";
import type { IncomingMessage } from "http";

export const MAX_REDIRECTS = 5;

const REDIRECTS = [301, 302, 303, 307, 308];

/**
 * GET over https only. Follows up to MAX_REDIRECTS redirects, each of which must stay on https
 * (GitHub release assets redirect to their CDN). Resolves with the final 200 response, unread.
 */
export function httpsGet(url: string, timeoutMs: number, redirectsLeft = MAX_REDIRECTS): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            reject(new Error(`Invalid download URL: ${url}`));
            return;
        }
        if (parsed.protocol !== "https:") {
            reject(new Error(`Refusing non-https download URL: ${url}`));
            return;
        }

        const req = https.get(parsed.href, { headers: { "User-Agent": "asl-gokart-headunit" } }, (res) => {
            const status = res.statusCode ?? 0;
            if (REDIRECTS.includes(status) && res.headers.location) {
                res.resume();
                if (redirectsLeft <= 0) {
                    reject(new Error("Download failed: too many redirects"));
                    return;
                }
                httpsGet(new URL(res.headers.location, parsed).href, timeoutMs, redirectsLeft - 1).then(resolve, reject);
                return;
            }
            if (status !== 200) {
                res.resume();
                reject(new Error(`Download failed with HTTP ${status}`));
                return;
            }
            resolve(res);
        });
        req.on("error", reject);
        req.setTimeout(timeoutMs, () => req.destroy(new Error(`Download timed out after ${timeoutMs / 1000}s`)));
    });
}
