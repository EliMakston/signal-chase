const LAST_FM_CATALOGUE_HOSTS = new Set(["last.fm", "www.last.fm"]);

export function getSafeLastFmTrackUrl(value: unknown): string | undefined {
    if (typeof value !== "string" || value.length > 2048) return undefined;

    try {
        const url = new URL(value);
        if (
            url.protocol !== "https:" ||
            !LAST_FM_CATALOGUE_HOSTS.has(url.hostname.toLowerCase()) ||
            url.username ||
            url.password ||
            url.port
        ) {
            return undefined;
        }

        const segments = url.pathname.split("/").filter(Boolean);
        if (
            segments.length !== 4 ||
            segments[0] !== "music" ||
            segments[2] !== "_"
        ) {
            return undefined;
        }
        for (const segment of [segments[1], segments[3]]) {
            const decoded = decodeURIComponent(segment);
            if (
                !decoded.trim() ||
                decoded.includes("/") ||
                decoded.includes("\\") ||
                /[\u0000-\u001f\u007f]/.test(decoded)
            ) {
                return undefined;
            }
        }

        return url.href;
    } catch {
        return undefined;
    }
}
