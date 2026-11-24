const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 256 * 1024;
const DEFAULT_MAX_ENTRIES = 64;
const MAX_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
    body: string;
    expiresAt: number;
    size: number;
}

function cacheLifetimeMs(headers: Headers, now: number): number {
    const cacheControl = headers.get("Cache-Control");
    const directives = new Map<string, string | null>();
    if (cacheControl) {
        for (const directive of cacheControl.split(",")) {
            const [rawName, ...rawValue] = directive.trim().split("=");
            if (!rawName) continue;
            const value = rawValue.join("=").trim().replace(/^"|"$/g, "");
            directives.set(rawName.toLowerCase(), value || null);
        }
    }

    if (
        directives.has("no-store") ||
        directives.has("no-cache") ||
        directives.has("private")
    ) {
        return 0;
    }

    if (headers.has("Set-Cookie") || headers.has("Vary")) return 0;

    const maxAge = directives.get("s-maxage") ?? directives.get("max-age");
    let freshnessMs: number;
    if (maxAge !== undefined && maxAge !== null && /^\d+$/.test(maxAge)) {
        freshnessMs = Number(maxAge) * 1000;
    } else {
        const expiresAt = Date.parse(headers.get("Expires") ?? "");
        const dateAt = Date.parse(headers.get("Date") ?? "") || now;
        if (!Number.isFinite(expiresAt)) return 0;
        freshnessMs = expiresAt - dateAt;
    }

    const ageSeconds = Number(headers.get("Age") ?? "0");
    const ageMs =
        Number.isFinite(ageSeconds) && ageSeconds >= 0
            ? ageSeconds * 1000
            : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(MAX_TTL_MS, freshnessMs - ageMs));
}

export class LastFmResponseCache {
    private readonly entries = new Map<string, CacheEntry>();
    private cachedBytes = 0;

    constructor(
        private readonly maxBytes = DEFAULT_MAX_BYTES,
        private readonly maxEntryBytes = DEFAULT_MAX_ENTRY_BYTES,
        private readonly maxEntries = DEFAULT_MAX_ENTRIES,
        private readonly now: () => number = Date.now,
    ) {}

    get(key: string): string | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= this.now()) {
            this.delete(key, entry);
            return undefined;
        }

        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.body;
    }

    set(key: string, body: string, headers: Headers): void {
        const now = this.now();
        const lifetime = cacheLifetimeMs(headers, now);
        if (lifetime <= 0) return;

        const size = new TextEncoder().encode(body).byteLength;
        if (size === 0 || size > this.maxEntryBytes || size > this.maxBytes) {
            return;
        }

        const previous = this.entries.get(key);
        if (previous) this.delete(key, previous);

        while (
            this.entries.size >= this.maxEntries ||
            this.cachedBytes + size > this.maxBytes
        ) {
            const oldestKey = this.entries.keys().next().value;
            if (oldestKey === undefined) break;
            const oldest = this.entries.get(oldestKey);
            if (oldest) this.delete(oldestKey, oldest);
        }

        this.entries.set(key, { body, expiresAt: now + lifetime, size });
        this.cachedBytes += size;
    }

    private delete(key: string, entry: CacheEntry): void {
        this.entries.delete(key);
        this.cachedBytes -= entry.size;
    }
}
