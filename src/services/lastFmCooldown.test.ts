import { describe, expect, it, vi } from "vitest";
import { parseRetryAfter } from "./retryAfter";
import {
    LastFmRequestAccounting,
    LocalLastFmCooldown,
    LocalLastFmRequestTransport,
} from "./lastFmRequestTransport";
import { LastFmMusicProvider } from "./lastFmMusicProvider";
import { buildGraphWithDiagnostics } from "./graphBuilder";

describe("Retry-After", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    it.each([null, "", "-1", "0", "1.5", "nonsense", "Wed, 31 Dec 2025 23:59:59 GMT", "Thu, 31 Feb 2026 00:01:30 GMT"])(
        "uses the 60-second fallback for %s", (value) => {
            expect(parseRetryAfter(value, () => now)).toBe(60n);
        },
    );
    it("preserves integer delays, large values and HTTP dates", () => {
        expect(parseRetryAfter("7200", () => now)).toBe(7200n);
        expect(parseRetryAfter("999999999999999999999999999", () => now)).toBe(999999999999999999999999999n);
        expect(parseRetryAfter("Thu, 01 Jan 2026 00:01:30 GMT", () => now + 250)).toBe(90n);
        expect(parseRetryAfter("Thursday, 01-Jan-26 00:01:30 GMT", () => now)).toBe(90n);
        expect(parseRetryAfter("Thu Jan  1 00:01:30 2026", () => now)).toBe(90n);
    });
});

describe("isolate-local provider cooldown", () => {
    it.each([
        [429, "20", 20n],
        [429, "invalid", 60n],
        [429, "Thu, 01 Jan 2026 00:02:00 GMT", 120n],
        [200, "90", 90n],
        [200, "Thu, 01 Jan 2026 00:02:00 GMT", 120n],
    ])("blocks all methods after status %s with Retry-After %s", async (status, header, expected) => {
        let now = Date.parse("2026-01-01T00:00:00Z");
        const cooldown = new LocalLastFmCooldown(() => now);
        const accounting = new LastFmRequestAccounting();
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: 29 }), {
                status, headers: { "Retry-After": header },
            }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ track: { name: "Track", artist: "Artist" } })));
        const transport = new LocalLastFmRequestTransport(fetcher, accounting, cooldown);
        const provider = new LastFmMusicProvider("key", fetcher, 10000, undefined, undefined, { transport, accounting });
        await expect(provider.searchSongs("query")).rejects.toMatchObject({
            kind: "rate_limited", details: { retryAfterSeconds: expected },
        });
        await expect(provider.getSimilarSongs("lastfm:Artist:Track")).rejects.toMatchObject({
            kind: "rate_limited", details: { retryAfterSeconds: expected },
        });
        await expect(provider.getSong("lastfm:Artist:Track")).rejects.toMatchObject({ kind: "rate_limited" });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(accounting.snapshot()).toEqual({ providerInvocations: 3, outboundAttempts: 1, cacheHits: 0 });
        now += Number(expected) * 1000;
        await expect(provider.getSong("lastfm:Artist:Track")).resolves.toMatchObject({ title: "Track" });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("never shortens a cooldown when concurrent responses arrive out of order", async () => {
        let now = 1000;
        const cooldown = new LocalLastFmCooldown(() => now);
        const releases: Array<(response: Response) => void> = [];
        const fetcher = vi.fn<typeof fetch>(() => new Promise((resolve) => releases.push(resolve)));
        const transport = new LocalLastFmRequestTransport(fetcher, new LastFmRequestAccounting(), cooldown);
        const request = { method: "track.search" as const, params: {}, apiKey: "key", signal: new AbortController().signal };
        const first = transport.dispatch(request);
        const second = transport.dispatch(request);
        releases[0](new Response("", { status: 429, headers: { "Retry-After": "100" } }));
        await first;
        now += 1000;
        releases[1](new Response("", { status: 429, headers: { "Retry-After": "5" } }));
        await second;
        expect(cooldown.remaining()).toBe(99n);
        await expect(transport.dispatch(request)).rejects.toMatchObject({ retryAfterSeconds: 99n });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("stops graph expansion on provider throttling", async () => {
        const cooldown = new LocalLastFmCooldown(() => 0);
        const accounting = new LastFmRequestAccounting();
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify({ track: { name: "Track", artist: "Artist" } })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: 29 }), { headers: { "Retry-After": "40" } }));
        const transport = new LocalLastFmRequestTransport(fetcher, accounting, cooldown);
        const provider = new LastFmMusicProvider("key", fetcher, 10000, undefined, undefined, { transport, accounting });
        await expect(buildGraphWithDiagnostics(provider, "lastfm:Artist:Track")).rejects.toMatchObject({
            kind: "provider_failure", cause: { kind: "rate_limited", details: { retryAfterSeconds: 40n } },
        });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("preserves cancellation before dispatch even when cooldown is active", async () => {
        const cooldown = new LocalLastFmCooldown(() => 0);
        cooldown.activate("60");
        const fetcher = vi.fn<typeof fetch>();
        const accounting = new LastFmRequestAccounting();
        const transport = new LocalLastFmRequestTransport(fetcher, accounting, cooldown);
        const controller = new AbortController();
        controller.abort();
        const provider = new LastFmMusicProvider("key", fetcher, 10000, controller.signal, undefined, { transport, accounting });
        await expect(provider.getSong("lastfm:Artist:Track")).rejects.toMatchObject({ kind: "timeout" });
        expect(fetcher).not.toHaveBeenCalled();
        expect(accounting.snapshot()).toMatchObject({ providerInvocations: 1, outboundAttempts: 0 });
    });
});
