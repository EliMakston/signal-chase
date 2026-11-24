import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppContext, Env } from "../../worker.js";
import type { SerializedSongGraph } from "../game/graphSerialization";
import { registerAuthAndIntegrationRoutes } from "./http-routes";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const alwaysAllowRateLimit: RateLimit = {
    limit: async () => ({ success: true }),
};

function musicApp(options: {
    enabled?: boolean;
    limiter?: RateLimit | null;
} = {}) {
    const app = new Hono<AppContext>();
    app.use('/api/music/*', async (c, next) => {
        if (c.env && options.enabled !== false) c.env.LASTFM_ENABLED = 'true';
        if (c.env && options.limiter !== null) {
            c.env.MUSIC_API_LIMITER =
                options.limiter ?? alwaysAllowRateLimit;
        }
        await next();
    });
    registerAuthAndIntegrationRoutes(app);
    return app;
}

describe("/api/music/search", () => {
    it("disables public Last.fm search without an upstream request", async () => {
        const fetcher = vi.fn<typeof fetch>();
        vi.stubGlobal("fetch", fetcher);
        const response = await musicApp({ enabled: false }).request(
            "/api/music/search?query=track",
            undefined,
            { LASTFM_API_KEY: "configured" } as Env,
        );

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
            code: "live_music_disabled",
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("returns canonical Last.fm track-search results", async () => {
        const apiKey = "search-route-test-secret";
        const fetcher = vi.fn<typeof fetch>(async (input) => {
            const url = new URL(String(input));
            expect(url.searchParams.get("method")).toBe("track.search");
            expect(url.searchParams.get("track")).toBe("Midnight City");
            expect(url.searchParams.get("api_key")).toBe(apiKey);
            return new Response(
                JSON.stringify({
                    results: {
                        trackmatches: {
                            track: [
                                {
                                    name: "Midnight City",
                                    artist: "M83",
                                    image: [{ size: "large", "#text": "cover.jpg" }],
                                },
                                { name: "Incomplete result" },
                            ],
                        },
                    },
                }),
                { status: 200 },
            );
        });
        vi.stubGlobal("fetch", fetcher);
        const app = musicApp();

        const response = await app.request(
            "/api/music/search?query=Midnight%20City",
            undefined,
            { LASTFM_API_KEY: apiKey } as Env,
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            songs: [
                {
                    id: "lastfm:M83:Midnight%20City",
                    title: "Midnight City",
                    artist: "M83",
                    albumArt: "",
                },
            ],
        });
    });

    it("validates the query and returns 503 when credentials are missing", async () => {
        const fetcher = vi.fn<typeof fetch>();
        vi.stubGlobal("fetch", fetcher);
        const app = musicApp();

        const missing = await app.request("/api/music/search");
        const tooLong = await app.request(
            `/api/music/search?query=${"a".repeat(121)}`,
            undefined,
            { LASTFM_API_KEY: "configured" } as Env,
        );
        const unconfigured = await app.request(
            "/api/music/search?query=track",
            undefined,
            {} as Env,
        );

        expect(missing.status).toBe(400);
        expect(tooLong.status).toBe(400);
        expect(unconfigured.status).toBe(503);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("returns a safe 429 response and logs no query or credential values on provider rate limiting", async () => {
        const apiKey = "search-route-secret";
        const query = "secret query";
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ error: 29, message: "Rate limited" }), {
                status: 200,
            }),
        );
        vi.stubGlobal("fetch", fetcher);
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const app = musicApp();

        const response = await app.request(
            `/api/music/search?query=${encodeURIComponent(query)}`,
            undefined,
            { LASTFM_API_KEY: apiKey } as Env,
        );

        expect(response.status).toBe(429);
        expect(response.headers.get("Retry-After")).toBe("60");
        await expect(response.json()).resolves.toEqual({
            code: "rate_limited",
            error: "Live music requests are temporarily rate-limited.",
        });
        expect(JSON.stringify(log.mock.calls)).not.toContain(query);
        expect(JSON.stringify(log.mock.calls)).not.toContain(apiKey);
        expect(log).toHaveBeenCalledWith(
            "[music] Track search failed",
            expect.objectContaining({
                errorType: "LastFmProviderError",
                errorKind: "rate_limited",
                stage: "lastfm_api",
                upstreamStatus: 200,
                lastFmErrorCode: 29,
            }),
        );
    });

    it("returns 429 with Retry-After when the shared limiter rejects a search", async () => {
        const limiter: RateLimit = {
            limit: vi.fn().mockResolvedValue({ success: false }),
        };
        const fetcher = vi.fn<typeof fetch>();
        vi.stubGlobal("fetch", fetcher);
        const response = await musicApp({ limiter }).request(
            "/api/music/search?query=track",
            { headers: { "CF-Connecting-IP": "203.0.113.8" } },
            { LASTFM_API_KEY: "configured" } as Env,
        );

        expect(response.status).toBe(429);
        expect(response.headers.get("Retry-After")).toBe("60");
        await expect(response.json()).resolves.toMatchObject({
            code: "rate_limited",
        });
        expect(limiter.limit).toHaveBeenCalledWith({
            key: "203.0.113.8",
            delta: 1,
        });
        expect(fetcher).not.toHaveBeenCalled();
    });
});

describe("/api/music/similar", () => {
    it("rejects missing and malformed song IDs and missing credentials without upstream calls", async () => {
        const fetcher = vi.fn<typeof fetch>();
        vi.stubGlobal("fetch", fetcher);
        const app = musicApp();

        const missing = await app.request("/api/music/similar", undefined, {} as Env);
        const malformed = await app.request(
            "/api/music/similar?songId=not-a-lastfm-id",
            undefined,
            { LASTFM_API_KEY: "configured" } as Env,
        );
        const unconfigured = await app.request(
            "/api/music/similar?songId=lastfm%3AArtist%3ATrack",
            undefined,
            {} as Env,
        );

        expect(missing.status).toBe(400);
        expect(malformed.status).toBe(400);
        expect(unconfigured.status).toBe(503);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("logs safe Last.fm diagnostics and maps provider throttling to a safe 429 response", async () => {
        const apiKey = "route-test-secret";
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    error: 29,
                    message: "Rate limit exceeded",
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                },
            ),
        );
        vi.stubGlobal("fetch", fetcher);
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const app = musicApp();

        const response = await app.request(
            "/api/music/similar?songId=lastfm%3AArtist%3ATrack",
            undefined,
            { LASTFM_API_KEY: apiKey } as Env,
        );

        expect(response.status).toBe(429);
        expect(response.headers.get("Retry-After")).toBe("60");
        await expect(response.json()).resolves.toEqual({
            code: "rate_limited",
            error: "Live music requests are temporarily rate-limited.",
        });
        expect(log).toHaveBeenCalledWith(
            "[music] Similar-track lookup failed",
            expect.objectContaining({
                errorType: "LastFmProviderError",
                errorKind: "rate_limited",
                stage: "lastfm_api",
                upstreamStatus: 200,
                lastFmErrorCode: 29,
                upstreamErrorType: undefined,
            }),
        );
        expect(JSON.stringify(log.mock.calls)).not.toContain(apiKey);
    });

    it("returns a safe timeout response after an upstream timeout", async () => {
        const fetcher = vi.fn<typeof fetch>().mockRejectedValue(
            new DOMException("timeout details", "TimeoutError"),
        );
        vi.stubGlobal("fetch", fetcher);
        const response = await musicApp().request(
            "/api/music/similar?songId=lastfm%3AArtist%3ATrack",
            undefined,
            { LASTFM_API_KEY: "secret-key" } as Env,
        );

        expect(response.status).toBe(504);
        await expect(response.json()).resolves.toEqual({
            code: "upstream_timeout",
            error: "The music provider timed out. Please retry.",
        });
    });
});

describe("/api/music/graph", () => {
    const apiKey = "graph-route-test-secret";

    function graphFetch() {
        return vi.fn<typeof fetch>(async (input) => {
            const url = new URL(String(input));
            const method = url.searchParams.get("method");

            if (method === "track.getInfo") {
                return new Response(
                    JSON.stringify({
                        track: {
                            name: url.searchParams.get("track"),
                            artist: { name: url.searchParams.get("artist") },
                            image: [],
                        },
                    }),
                    { status: 200 },
                );
            }

            if (method === "track.getsimilar") {
                const isSeed = url.searchParams.get("track") === "Seed";
                return new Response(
                    JSON.stringify({
                        similartracks: {
                            track: isSeed
                                ? [{ name: "Related", artist: { name: "Band" } }]
                                : [],
                        },
                    }),
                    { status: 200 },
                );
            }

            return new Response(JSON.stringify({ error: 3, message: "Invalid method" }), {
                status: 200,
            });
        });
    }

    function graphApp() {
        return musicApp();
    }

    function graphUrl(seedSongId: string): string {
        return `/api/music/graph?seedSongId=${encodeURIComponent(seedSongId)}`;
    }

    it("disables all public Last.fm endpoints before upstream access", async () => {
        const fetcher = vi.fn<typeof fetch>();
        vi.stubGlobal("fetch", fetcher);
        const app = musicApp({ enabled: false });
        const env = { LASTFM_API_KEY: apiKey } as Env;
        const responses = await Promise.all([
            app.request("/api/music/search?query=track", undefined, env),
            app.request(
                "/api/music/similar?songId=lastfm%3ABand%3ATrack",
                undefined,
                env,
            ),
            app.request(graphUrl("lastfm:Band:Seed"), undefined, env),
        ]);

        expect(responses.map(({ status }) => status)).toEqual([503, 503, 503]);
        for (const response of responses) {
            await expect(response.json()).resolves.toMatchObject({
                code: "live_music_disabled",
            });
        }
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("charges a full graph-build budget against the shared limiter", async () => {
        const limiter: RateLimit = {
            limit: vi.fn().mockResolvedValue({ success: true }),
        };
        const fetcher = graphFetch();
        vi.stubGlobal("fetch", fetcher);
        const response = await musicApp({ limiter }).request(
            graphUrl("lastfm:Band:Seed"),
            { headers: { "CF-Connecting-IP": "203.0.113.12" } },
            { LASTFM_API_KEY: apiKey } as Env,
        );

        expect(response.status).toBe(200);
        expect(limiter.limit).toHaveBeenCalledWith({
            key: "203.0.113.12",
            delta: 30,
        });
    });

    it("fails closed when the production rate-limit binding is missing", async () => {
        const fetcher = graphFetch();
        vi.stubGlobal("fetch", fetcher);
        const response = await musicApp({ limiter: null }).request(
            graphUrl("lastfm:Band:Seed"),
            undefined,
            { LASTFM_API_KEY: apiKey } as Env,
        );

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
            code: "music_protection_unavailable",
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("returns a serialized graph and does not cache Last.fm data", async () => {
        const fetcher = graphFetch();
        vi.stubGlobal("fetch", fetcher);
        const app = graphApp();
        const seedSongId = "lastfm:Band:Seed";

        const firstResponse = await app.request(
            graphUrl(seedSongId),
            undefined,
            { LASTFM_API_KEY: apiKey } as Env,
        );
        const firstGraph = await firstResponse.json();
        const secondResponse = await app.request(
            graphUrl(seedSongId),
            undefined,
            { LASTFM_API_KEY: apiKey } as Env,
        );

        expect(firstResponse.status).toBe(200);
        expect(firstGraph).toEqual({
            songs: [
                {
                    id: "lastfm:Band:Seed",
                    title: "Seed",
                    artist: "Band",
                    albumArt: "",
                },
                {
                    id: "lastfm:Band:Related",
                    title: "Related",
                    artist: "Band",
                    albumArt: "",
                },
            ],
            edges: [
                {
                    songId: "lastfm:Band:Seed",
                    recommendations: ["lastfm:Band:Related"],
                },
                { songId: "lastfm:Band:Related", recommendations: [] },
            ],
            expandedSongIds: [
                "lastfm:Band:Seed",
                "lastfm:Band:Related",
            ],
        });
        expect(secondResponse.status).toBe(200);
        await expect(secondResponse.json()).resolves.toEqual(firstGraph);
        expect(fetcher).toHaveBeenCalledTimes(6);
    });

    it("canonicalizes an unencoded seed with spaces to the provider song ID", async () => {
        const fetcher = vi.fn<typeof fetch>(async (input) => {
            const url = new URL(String(input));
            const method = url.searchParams.get("method");
            if (method === "track.getInfo") {
                return new Response(
                    JSON.stringify({
                        track: {
                            name: "Midnight City",
                            artist: { name: "M83" },
                            image: [],
                        },
                    }),
                    { status: 200 },
                );
            }
            return new Response(
                JSON.stringify({ similartracks: { track: [] } }),
                { status: 200 },
            );
        });
        vi.stubGlobal("fetch", fetcher);

        const response = await graphApp().request(
            graphUrl("lastfm:M83:Midnight City"),
            undefined,
            { LASTFM_API_KEY: apiKey } as Env,
        );
        const graph = (await response.json()) as SerializedSongGraph;

        expect(response.status).toBe(200);
        expect(graph.songs[0].id).toBe("lastfm:M83:Midnight%20City");
        const [requestUrl] = fetcher.mock.calls[0];
        expect(
            new URL(String(requestUrl)).searchParams.get("track"),
        ).toBe("Midnight City");
    });

    it("returns 400 for missing, malformed, or nonexistent seed songs", async () => {
        const fetcher = graphFetch();
        fetcher.mockImplementation(async () => new Response(JSON.stringify({}), { status: 200 }));
        vi.stubGlobal("fetch", fetcher);
        const app = graphApp();

        const missing = await app.request(
            "/api/music/graph",
            undefined,
            { LASTFM_API_KEY: apiKey } as Env,
        );
        const malformed = await app.request(
            graphUrl("not-a-lastfm-id"),
            undefined,
            { LASTFM_API_KEY: apiKey } as Env,
        );
        const nonexistent = await app.request(
            graphUrl("lastfm:Missing:Seed"),
            undefined,
            { LASTFM_API_KEY: apiKey } as Env,
        );

        expect(missing.status).toBe(400);
        expect(malformed.status).toBe(400);
        expect(nonexistent.status).toBe(400);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("returns 503 when Last.fm credentials are missing", async () => {
        const fetcher = graphFetch();
        vi.stubGlobal("fetch", fetcher);
        const response = await graphApp().request(
            graphUrl("lastfm:Band:Seed"),
            undefined,
            {} as Env,
        );

        expect(response.status).toBe(503);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("caps returned recommendations at the server-side limit", async () => {
        const fetcher = vi.fn<typeof fetch>(async (input) => {
            const url = new URL(String(input));
            const method = url.searchParams.get("method");
            if (method === "track.getInfo") {
                return new Response(
                    JSON.stringify({
                        track: {
                            name: "Seed",
                            artist: { name: "LimitBand" },
                        },
                    }),
                    { status: 200 },
                );
            }

            const trackName = url.searchParams.get("track");
            const tracks =
                trackName === "Seed"
                    ? Array.from({ length: 8 }, (_, index) => ({
                          name: `Related ${index}`,
                          artist: { name: "LimitBand" },
                      }))
                    : [];
            return new Response(
                JSON.stringify({ similartracks: { track: tracks } }),
                { status: 200 },
            );
        });
        vi.stubGlobal("fetch", fetcher);

        const response = await graphApp().request(
            graphUrl("lastfm:LimitBand:Seed"),
            undefined,
            { LASTFM_API_KEY: apiKey } as Env,
        );
        const graph = (await response.json()) as SerializedSongGraph;

        expect(response.status).toBe(200);
        expect(graph.songs).toHaveLength(7);
        expect(graph.edges[0].recommendations).toHaveLength(6);
        expect(fetcher).toHaveBeenCalledTimes(8);
    });

    it("returns 429 for upstream throttling and does not retain the failed build", async () => {
        let attempts = 0;
        const fetcher = vi.fn<typeof fetch>(async (input) => {
            attempts += 1;
            if (attempts === 1) {
                return new Response(JSON.stringify({ error: 29, message: "Rate limited" }), {
                    status: 200,
                });
            }
            return graphFetch()(input);
        });
        vi.stubGlobal("fetch", fetcher);
        const app = graphApp();
        const url = graphUrl("lastfm:Band:RetrySeed");

        const failed = await app.request(url, undefined, { LASTFM_API_KEY: apiKey } as Env);
        const succeeded = await app.request(url, undefined, { LASTFM_API_KEY: apiKey } as Env);

        expect(failed.status).toBe(429);
        expect(succeeded.status).toBe(200);
        expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it("coalesces simultaneous requests for the same seed", async () => {
        let releaseFetch: (() => void) | undefined;
        const fetchGate = new Promise<void>((resolve) => {
            releaseFetch = resolve;
        });
        const baseFetcher = graphFetch();
        const fetcher = vi.fn<typeof fetch>(async (input, init) => {
            await fetchGate;
            return baseFetcher(input, init);
        });
        vi.stubGlobal("fetch", fetcher);
        const app = graphApp();
        const url = graphUrl("lastfm:ConcurrentBand:Seed");

        const firstRequest = app.request(url, undefined, { LASTFM_API_KEY: apiKey } as Env);
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        const secondRequest = app.request(url, undefined, { LASTFM_API_KEY: apiKey } as Env);
        releaseFetch?.();

        const [firstResponse, secondResponse] = await Promise.all([
            firstRequest,
            secondRequest,
        ]);
        expect(firstResponse.status).toBe(200);
        expect(secondResponse.status).toBe(200);
        expect(fetcher).toHaveBeenCalledTimes(3);
    });
});
