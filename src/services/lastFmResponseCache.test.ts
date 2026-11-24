import { describe, expect, it } from "vitest";
import { LastFmResponseCache } from "./lastFmResponseCache";

describe("LastFmResponseCache", () => {
    it("expires entries at the upstream max-age boundary", () => {
        let now = 1_000;
        const cache = new LastFmResponseCache(1024, 1024, 4, () => now);
        cache.set("track", '{"track":{}}', new Headers({ "Cache-Control": "max-age=2" }));

        expect(cache.get("track")).toBe('{"track":{}}');
        now += 2_000;
        expect(cache.get("track")).toBeUndefined();
    });

    it.each(["no-store", "no-cache", "private", "max-age=0"])(
        "does not cache Cache-Control: %s",
        (directive) => {
            const cache = new LastFmResponseCache();
            cache.set(
                "track",
                '{"track":{}}',
                new Headers({ "Cache-Control": directive }),
            );
            expect(cache.get("track")).toBeUndefined();
        },
    );

    it("uses shared freshness, Age, and the Expires fallback", () => {
        let now = Date.parse("2026-01-01T00:00:00Z");
        const cache = new LastFmResponseCache(1024, 1024, 4, () => now);

        cache.set(
            "shared",
            "shared",
            new Headers({
                "Cache-Control": "public, max-age=100, s-maxage=20",
                Age: "5",
            }),
        );
        now += 15_000;
        expect(cache.get("shared")).toBeUndefined();

        cache.set(
            "expires",
            "expires",
            new Headers({
                Date: new Date(now).toUTCString(),
                Expires: new Date(now + 4_000).toUTCString(),
            }),
        );
        now += 3_000;
        expect(cache.get("expires")).toBe("expires");
        now += 1_000;
        expect(cache.get("expires")).toBeUndefined();
    });

    it("does not cache responses without explicit freshness, cookies, or Vary", () => {
        const cache = new LastFmResponseCache();
        cache.set("implicit", "implicit", new Headers());
        cache.set(
            "vary",
            "vary",
            new Headers({ "Cache-Control": "max-age=60", Vary: "Accept-Language" }),
        );
        cache.set(
            "cookie",
            "cookie",
            new Headers({ "Cache-Control": "max-age=60", "Set-Cookie": "session=x" }),
        );
        expect(cache.get("implicit")).toBeUndefined();
        expect(cache.get("vary")).toBeUndefined();
        expect(cache.get("cookie")).toBeUndefined();
    });

    it("bounds entry size, total bytes, and entry count with LRU eviction", () => {
        let now = 0;
        const cache = new LastFmResponseCache(8, 6, 2, () => now);
        const fresh = new Headers({ "Cache-Control": "max-age=60" });

        cache.set("too-large", "1234567", fresh);
        cache.set("first", "1234", fresh);
        cache.set("second", "5678", fresh);
        expect(cache.get("first")).toBe("1234");
        cache.set("third", "abcd", fresh);

        expect(cache.get("second")).toBeUndefined();
        expect(cache.get("first")).toBe("1234");
        expect(cache.get("third")).toBe("abcd");

        cache.set("fourth", "zzzz", fresh);
        expect(cache.get("first")).toBeUndefined();
        expect(cache.get("third")).toBe("abcd");
        expect(cache.get("fourth")).toBe("zzzz");

        now = 60_000;
        expect(cache.get("third")).toBeUndefined();
    });
});
