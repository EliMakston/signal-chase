import { afterEach, describe, expect, it, vi } from "vitest";
import {
    LastFmMusicProvider,
    LastFmProviderError,
} from "./lastFmMusicProvider";
import { LastFmResponseCache } from "./lastFmResponseCache";
import { buildGraphWithDiagnostics } from "./graphBuilder";
import {
    LastFmRequestAccounting,
    lastFmCooldown,
    LocalLastFmRequestTransport,
} from "./lastFmRequestTransport";
import type { LastFmRequestTransport } from "./lastFmRequestTransport";

afterEach(() => lastFmCooldown.reset());

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function mockFetch(payload: unknown, status = 200) {
    return vi
        .fn<typeof fetch>()
        .mockImplementation(async () => jsonResponse(payload, status));
}

describe("LastFmMusicProvider", () => {
    it("normalizes track information without exposing artwork excluded by Last.fm terms", async () => {
        const fetcher = mockFetch({
            track: {
                name: "Signal: Noise",
                artist: { name: "A & B" },
                url: "https://www.last.fm/music/A+%26+B/_/Signal%3A+Noise",
                image: [
                    { size: "small", "#text": "small.jpg" },
                    { size: "extralarge", "#text": "large.jpg" },
                ],
            },
        });
        const provider = new LastFmMusicProvider("test-key", fetcher);

        await expect(
            provider.getSong("lastfm:A%20%26%20B:Signal%3A%20Noise"),
        ).resolves.toEqual({
            id: "lastfm:A%20%26%20B:Signal%3A%20Noise",
            title: "Signal: Noise",
            artist: "A & B",
            albumArt: "",
            lastFmUrl: "https://www.last.fm/music/A+%26+B/_/Signal%3A+Noise",
        });

        const [requestUrl] = fetcher.mock.calls[0];
        const url = new URL(String(requestUrl));
        expect(url.searchParams.get("method")).toBe("track.getInfo");
        expect(url.searchParams.get("artist")).toBe("A & B");
        expect(url.searchParams.get("track")).toBe("Signal: Noise");
        expect(url.searchParams.get("api_key")).toBe("test-key");
        expect(url.searchParams.get("format")).toBe("json");
        expect(fetcher.mock.calls[0][1]?.headers).toEqual({
            "User-Agent": "SignalChase/0.1.1 (https://signal-chase.app.space)",
        });
    });

    it("caches a successful response only for its upstream freshness lifetime", async () => {
        let now = 0;
        const cache = new LastFmResponseCache(4096, 2048, 8, () => now);
        const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
            new Response(
                JSON.stringify({
                    track: { name: "Track", artist: "Artist", url: "https://www.last.fm/music/Artist/_/Track" },
                }),
                {
                    headers: {
                        "Cache-Control": "public, max-age=2",
                        "Content-Type": "application/json",
                    },
                },
            ),
        );
        const provider = new LastFmMusicProvider(
            "test-key",
            fetcher,
            10_000,
            undefined,
            cache,
            { cacheEnabled: true },
        );

        await provider.getSong("lastfm:Artist:Track");
        await provider.getSong("lastfm:Artist:Track");
        expect(fetcher).toHaveBeenCalledTimes(1);

        now = 2_000;
        await provider.getSong("lastfm:Artist:Track");
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("routes every method through an injectable transport", async () => {
        const dispatch = vi.fn<LastFmRequestTransport["dispatch"]>(async ({ method }) => {
            const payload = method === "track.getInfo"
                ? { track: { name: "Track", artist: "Artist" } }
                : method === "track.getsimilar"
                  ? { similartracks: { track: [] } }
                  : { results: { trackmatches: { track: [] } } };
            return jsonResponse(payload);
        });
        const accounting = new LastFmRequestAccounting();
        const provider = new LastFmMusicProvider("test-key", fetch, 10_000, undefined, undefined, {
            transport: { dispatch, recordThrottle: () => 60n, remainingCooldown: () => 0n },
            accounting,
        });

        await provider.getSong("lastfm:Artist:Track");
        await provider.getSimilarSongs("lastfm:Artist:Track");
        await provider.searchSongs("Track");
        expect(dispatch.mock.calls.map(([request]) => request.method)).toEqual([
            "track.getInfo", "track.getsimilar", "track.search",
        ]);
        expect(accounting.snapshot()).toEqual({
            providerInvocations: 3, outboundAttempts: 0, cacheHits: 0,
        });
    });

    it("counts successful, failed, throttled and timed-out outbound attempts", async () => {
        const accounting = new LastFmRequestAccounting();
        const fetcher = vi.fn<typeof fetch>()
            .mockImplementationOnce(async () => jsonResponse({ track: { name: "Track", artist: "Artist" } }))
            .mockRejectedValueOnce(new TypeError("network failure"))
            .mockImplementationOnce(async () => jsonResponse({ error: 29 }, 429))
            .mockImplementationOnce((_input, init) => new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
            }));
        const transport = new LocalLastFmRequestTransport(fetcher, accounting);
        const provider = new LastFmMusicProvider("test-key", fetcher, 5, undefined, undefined, {
            transport,
            accounting,
        });

        await provider.getSong("lastfm:Artist:Track");
        await expect(provider.getSong("lastfm:Artist:Track")).rejects.toMatchObject({ kind: "network" });
        await expect(provider.getSong("lastfm:Artist:Track")).rejects.toMatchObject({ kind: "rate_limited" });
        lastFmCooldown.reset();
        await expect(provider.getSong("lastfm:Artist:Track")).rejects.toMatchObject({ kind: "timeout" });
        expect(accounting.snapshot()).toEqual({
            providerInvocations: 4, outboundAttempts: 4, cacheHits: 0,
        });
    });

    it("bypasses cache reads and writes by default, even with an injected cache", async () => {
        const cache = new LastFmResponseCache();
        const get = vi.spyOn(cache, "get");
        const set = vi.spyOn(cache, "set");
        const accounting = new LastFmRequestAccounting();
        const fetcher = vi.fn<typeof fetch>(async () => new Response(
            JSON.stringify({ track: { name: "Track", artist: "Artist" } }),
            { headers: { "Cache-Control": "max-age=60" } },
        ));
        const provider = new LastFmMusicProvider("test-key", fetcher, 10_000, undefined, cache, { accounting });

        await provider.getSong("lastfm:Artist:Track");
        await provider.getSong("lastfm:Artist:Track");
        expect(get).not.toHaveBeenCalled();
        expect(set).not.toHaveBeenCalled();
        expect(accounting.snapshot()).toEqual({
            providerInvocations: 2, outboundAttempts: 2, cacheHits: 0,
        });
    });

    it("counts validated cache hits separately from network attempts", async () => {
        const cache = new LastFmResponseCache();
        const accounting = new LastFmRequestAccounting();
        const fetcher = vi.fn<typeof fetch>(async () => new Response(
            JSON.stringify({ track: { name: "Track", artist: "Artist" } }),
            { headers: { "Cache-Control": "max-age=60" } },
        ));
        const provider = new LastFmMusicProvider("test-key", fetcher, 10_000, undefined, cache, {
            accounting, cacheEnabled: true,
        });

        await provider.getSong("lastfm:Artist:Track");
        await provider.getSong("lastfm:Artist:Track");
        expect(accounting.snapshot()).toEqual({
            providerInvocations: 2, outboundAttempts: 1, cacheHits: 1,
        });
    });

    it("does not dispatch for missing credentials, invalid IDs, or empty searches", async () => {
        const accounting = new LastFmRequestAccounting();
        const dispatch = vi.fn<LastFmRequestTransport["dispatch"]>();
        const provider = new LastFmMusicProvider(undefined, fetch, 10_000, undefined, undefined, {
            accounting, transport: { dispatch, recordThrottle: () => 60n, remainingCooldown: () => 0n }, cacheEnabled: true,
        });
        await expect(provider.getSong("lastfm:Artist:Track")).rejects.toMatchObject({ kind: "configuration" });
        await expect(provider.getSimilarSongs("bad-id")).rejects.toMatchObject({ kind: "invalid_song_id" });
        await expect(provider.searchSongs(" ")).resolves.toEqual([]);
        expect(dispatch).not.toHaveBeenCalled();
        expect(accounting.snapshot()).toEqual({
            providerInvocations: 3, outboundAttempts: 0, cacheHits: 0,
        });
    });

    it.each([
        ["similar", { similartracks: { track: [{ name: "Track", artist: "Artist" }] } }],
        ["search", { results: { trackmatches: { track: [{ name: "Track", artist: "Artist" }] } } }],
    ])("caches validated %s results when enabled", async (method, payload) => {
        const accounting = new LastFmRequestAccounting();
        const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(payload), {
            headers: { "Cache-Control": "max-age=60" },
        }));
        const provider = new LastFmMusicProvider("test-key", fetcher, 10_000, undefined, new LastFmResponseCache(), {
            accounting, cacheEnabled: true,
        });
        const invoke = () => method === "similar"
            ? provider.getSimilarSongs("lastfm:Artist:Track")
            : provider.searchSongs("Track");
        await invoke();
        await invoke();
        expect(accounting.snapshot()).toEqual({
            providerInvocations: 2, outboundAttempts: 1, cacheHits: 1,
        });
    });

    it("preserves graph provider-call budgets when cached responses avoid network attempts", async () => {
        const accounting = new LastFmRequestAccounting();
        const fetcher = vi.fn<typeof fetch>(async (input) => {
            const method = new URL(String(input)).searchParams.get("method");
            return new Response(JSON.stringify(method === "track.getInfo"
                ? { track: { name: "Track", artist: "Artist" } }
                : { similartracks: { track: [] } }), {
                headers: { "Cache-Control": "max-age=60" },
            });
        });
        const provider = new LastFmMusicProvider("test-key", fetcher, 10_000, undefined, new LastFmResponseCache(), {
            accounting, cacheEnabled: true,
        });
        const first = await buildGraphWithDiagnostics(provider, "lastfm:Artist:Track", { maxRequests: 2 });
        const second = await buildGraphWithDiagnostics(provider, "lastfm:Artist:Track", { maxRequests: 2 });
        expect(first.diagnostics.upstreamRequestCount).toBe(2);
        expect(second.diagnostics.upstreamRequestCount).toBe(2);
        expect(accounting.snapshot()).toEqual({
            providerInvocations: 4, outboundAttempts: 2, cacheHits: 2,
        });
    });

    it.each([
        ["track", { track: { name: "missing artist" } }],
        ["track", { track: "invalid" }],
        ["similar", { similartracks: { track: [{ name: "missing artist" }] } }],
        ["similar", { similartracks: "invalid" }],
        ["search", { results: { trackmatches: { track: [{ name: "missing artist" }] } } }],
        ["search", { results: "invalid" }],
        ["track", { error: 29 }],
    ])("does not cache invalid %s responses", async (method, payload) => {
        const cache = new LastFmResponseCache();
        const set = vi.spyOn(cache, "set");
        const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(payload), {
            headers: { "Cache-Control": "max-age=60" },
        }));
        const provider = new LastFmMusicProvider("test-key", fetcher, 10_000, undefined, cache, {
            cacheEnabled: true,
        });
        const invoke = () => method === "track"
            ? provider.getSong("lastfm:Artist:Track")
            : method === "similar"
              ? provider.getSimilarSongs("lastfm:Artist:Track")
              : provider.searchSongs("Track");
        await Promise.allSettled([invoke(), invoke()]);
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(set).not.toHaveBeenCalled();
    });

    it("ignores generic Last.fm placeholder art", async () => {
        const provider = new LastFmMusicProvider(
            "test-key",
            mockFetch({
                track: {
                    name: "Track",
                    artist: "Artist",
                    image: [
                        {
                            size: "extralarge",
                            "#text":
                                "https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png",
                        },
                    ],
                },
            }),
        );

        await expect(provider.getSong("lastfm:Artist:Track")).resolves.toMatchObject({
            albumArt: "",
        });
    });

    it("returns null when track information is empty", async () => {
        const provider = new LastFmMusicProvider(
            "test-key",
            mockFetch({}),
        );

        await expect(
            provider.getSong("lastfm:Artist:Unknown"),
        ).resolves.toBeNull();
    });

    it("returns null when track metadata cannot be normalized", async () => {
        const provider = new LastFmMusicProvider(
            "test-key",
            mockFetch({ track: { name: "Track without artist" } }),
        );

        await expect(
            provider.getSong("lastfm:Artist:Track"),
        ).resolves.toBeNull();
    });

    it("normalizes similar tracks and skips entries missing required metadata", async () => {
        const fetcher = mockFetch({
            similartracks: {
                track: [
                    { name: "First", artist: "One" },
                    { name: "Missing artist" },
                    { name: "Second", artist: { name: "Two" } },
                ],
            },
        });
        const provider = new LastFmMusicProvider(
            "test-key",
            fetcher,
        );

        await expect(
            provider.getSimilarSongs("lastfm:Source:Track"),
        ).resolves.toEqual([
            {
                id: "lastfm:One:First",
                title: "First",
                artist: "One",
                albumArt: "",
            },
            {
                id: "lastfm:Two:Second",
                title: "Second",
                artist: "Two",
                albumArt: "",
            },
        ]);
        const [requestUrl] = fetcher.mock.calls[0];
        expect(new URL(String(requestUrl)).searchParams.get("method")).toBe(
            "track.getsimilar",
        );
    });

    it("invokes Worker fetch with the globalThis receiver", async () => {
        let fetchReceiver: unknown;
        const fetcher = vi.fn<typeof fetch>(function (this: unknown) {
            fetchReceiver = this;
            return Promise.resolve(
                jsonResponse({ similartracks: { track: [] } }),
            );
        });
        const provider = new LastFmMusicProvider("test-key", fetcher);

        await expect(
            provider.getSimilarSongs("lastfm:Source:Track"),
        ).resolves.toEqual([]);
        expect(fetchReceiver).toBe(globalThis);
    });

    it("handles a single similar-track object and empty recommendation lists", async () => {
        const singleTrack = new LastFmMusicProvider(
            "test-key",
            mockFetch({
                similartracks: {
                    track: { name: "Related", artist: "Artist" },
                },
            }),
        );
        const noTracks = new LastFmMusicProvider(
            "test-key",
            mockFetch({ similartracks: { track: [] } }),
        );

        await expect(
            singleTrack.getSimilarSongs("lastfm:Source:Track"),
        ).resolves.toHaveLength(1);
        await expect(
            noTracks.getSimilarSongs("lastfm:Source:Track"),
        ).resolves.toEqual([]);
    });

    it("normalizes search results and returns an empty list for a blank query", async () => {
        const fetcher = mockFetch({
            results: {
                trackmatches: {
                    track: [
                        { name: "Found", artist: "Singer" },
                        { name: "Incomplete" },
                    ],
                },
            },
        });
        const provider = new LastFmMusicProvider("test-key", fetcher);

        await expect(provider.searchSongs("  ")).resolves.toEqual([]);
        expect(fetcher).not.toHaveBeenCalled();
        await expect(provider.searchSongs("  found  ")).resolves.toEqual([
            {
                id: "lastfm:Singer:Found",
                title: "Found",
                artist: "Singer",
                albumArt: "",
            },
        ]);

        const [requestUrl] = fetcher.mock.calls[0];
        expect(new URL(String(requestUrl)).searchParams.get("method")).toBe(
            "track.search",
        );
        expect(new URL(String(requestUrl)).searchParams.get("track")).toBe(
            "found",
        );
    });

    it("rejects malformed or non-Last.fm song IDs before making a request", async () => {
        const fetcher = mockFetch({});
        const provider = new LastFmMusicProvider("test-key", fetcher);

        await expect(provider.getSong("song-1")).rejects.toMatchObject({
            kind: "invalid_song_id",
        });
        await expect(provider.getSimilarSongs("lastfm::Track")).rejects.toMatchObject({
            kind: "invalid_song_id",
        });
        await expect(
            provider.getSimilarSongs(`lastfm:Artist:${"a".repeat(513)}`),
        ).rejects.toMatchObject({ kind: "invalid_song_id" });
        await expect(
            provider.getSimilarSongs("lastfm:Artist:Track%0AInjected"),
        ).rejects.toMatchObject({ kind: "invalid_song_id" });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("reports missing server configuration without making a request", async () => {
        const fetcher = mockFetch({});
        const provider = new LastFmMusicProvider(undefined, fetcher);

        await expect(
            provider.getSimilarSongs("lastfm:Artist:Track"),
        ).rejects.toMatchObject({ kind: "configuration" });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("handles HTTP, Last.fm API, and malformed JSON errors", async () => {
        const httpFailure = new LastFmMusicProvider(
            "test-key",
            mockFetch({}, 503),
        );
        const apiFailure = new LastFmMusicProvider(
            "test-key",
            mockFetch({ error: 6, message: "Track not found" }),
        );
        const malformedJson = new LastFmMusicProvider(
            "test-key",
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response("not-json", {
                    headers: { "Content-Type": "application/json" },
                }),
            ),
        );

        await expect(
            httpFailure.getSong("lastfm:Artist:Track"),
        ).rejects.toMatchObject({ kind: "http" });
        await expect(
            apiFailure.getSong("lastfm:Artist:Track"),
        ).rejects.toMatchObject({ kind: "api" });
        await expect(
            malformedJson.getSong("lastfm:Artist:Track"),
        ).rejects.toMatchObject({ kind: "malformed" });
    });

    it("preserves safe Last.fm API diagnostics without retaining the API key", async () => {
        const provider = new LastFmMusicProvider(
            "secret key",
            mockFetch({
                error: 6,
                message: "Track not found for supplied credentials: secret key",
            }),
        );

        await expect(
            provider.getSimilarSongs("lastfm:Artist:Track"),
        ).rejects.toMatchObject({
            kind: "api",
            details: {
                upstreamStatus: 200,
                lastFmErrorCode: 6,
                lastFmErrorMessage:
                    "Track not found for supplied credentials: [redacted]",
            },
        });
    });

    it("uses Last.fm's documented lowercase similar method and identifies API errors", async () => {
        const fetcher = mockFetch({
            error: 3,
            message: "Invalid Method - No method with that name in this package",
        });
        const provider = new LastFmMusicProvider("test-key", fetcher);

        await expect(
            provider.getSimilarSongs("lastfm:Artist:Track"),
        ).rejects.toMatchObject({
            kind: "api",
            details: {
                stage: "lastfm_api",
                lastFmErrorCode: 3,
            },
        });
        const [requestUrl] = fetcher.mock.calls[0];
        expect(new URL(String(requestUrl)).searchParams.get("method")).toBe(
            "track.getsimilar",
        );
    });

    it("preserves Last.fm diagnostics on non-success HTTP responses", async () => {
        const provider = new LastFmMusicProvider(
            "test-key",
            mockFetch({ error: 29, message: "Rate limit exceeded" }, 429),
        );

        await expect(
            provider.getSimilarSongs("lastfm:Artist:Track"),
        ).rejects.toMatchObject({
            kind: "rate_limited",
            details: {
                upstreamStatus: 429,
                lastFmErrorCode: 29,
                lastFmErrorMessage: "Rate limit exceeded",
                retryAfterSeconds: 60n,
            },
        });
    });

    it("preserves an upstream Retry-After value", async () => {
        const provider = new LastFmMusicProvider(
            "test-key",
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response(JSON.stringify({}), {
                    status: 429,
                    headers: { "Retry-After": "45" },
                }),
            ),
        );

        await expect(
            provider.getSimilarSongs("lastfm:Artist:Track"),
        ).rejects.toMatchObject({
            kind: "rate_limited",
            details: { retryAfterSeconds: 45n },
        });
    });

    it("times out an upstream request and identifies the failure safely", async () => {
        const fetcher = vi.fn<typeof fetch>(
            (_input, init) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener(
                        "abort",
                        () => reject(init.signal?.reason),
                        { once: true },
                    );
                }),
        );
        const provider = new LastFmMusicProvider("test-key", fetcher, 5);

        await expect(
            provider.getSong("lastfm:Artist:Track"),
        ).rejects.toMatchObject({
            kind: "timeout",
            details: {
                stage: "fetch",
                upstreamErrorType: "TimeoutError",
            },
        });
    });

    it("records the upstream error type for network failures", async () => {
        const provider = new LastFmMusicProvider(
            "test-key",
            vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")),
        );

        await expect(
            provider.getSong("lastfm:Artist:Track"),
        ).rejects.toMatchObject({
            kind: "network",
            details: { upstreamErrorType: "TypeError" },
        });
    });

    it("reports malformed response structures explicitly", async () => {
        const provider = new LastFmMusicProvider(
            "test-key",
            mockFetch({ similartracks: "invalid" }),
        );

        await expect(
            provider.getSimilarSongs("lastfm:Artist:Track"),
        ).rejects.toBeInstanceOf(LastFmProviderError);
        await expect(
            provider.getSimilarSongs("lastfm:Artist:Track"),
        ).rejects.toMatchObject({ kind: "malformed" });
    });

    it("does not include the API key in request failure messages", async () => {
        const provider = new LastFmMusicProvider(
            "private-test-key",
            vi.fn<typeof fetch>().mockRejectedValue(new Error("network error")),
        );

        await expect(
            provider.getSong("lastfm:Artist:Track"),
        ).rejects.toThrow("Last.fm request failed.");
        await expect(
            provider.getSong("lastfm:Artist:Track"),
        ).rejects.not.toThrow("private-test-key");
    });
});
