import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppContext, Env } from "../../worker.js";
import type { SerializedSongGraph } from "../game/graphSerialization";
import { registerAuthAndIntegrationRoutes } from "./http-routes";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("/api/music/similar", () => {
    it("logs safe Last.fm diagnostics and preserves the client-facing 502 response", async () => {
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
        const app = new Hono<AppContext>();
        registerAuthAndIntegrationRoutes(app);

        const response = await app.request(
            "/api/music/similar?songId=lastfm%3AArtist%3ATrack",
            undefined,
            { LASTFM_API_KEY: apiKey } as Env,
        );

        expect(response.status).toBe(502);
        await expect(response.json()).resolves.toEqual({
            error: "Failed to fetch similar songs",
        });
        expect(log).toHaveBeenCalledWith(
            "[music] Similar-track lookup failed",
            {
                errorType: "LastFmProviderError",
                errorKind: "api",
                stage: "lastfm_api",
                apiKeyConfigured: true,
                upstreamStatus: 200,
                lastFmErrorCode: 29,
                lastFmErrorMessage: "Rate limit exceeded",
                upstreamErrorType: undefined,
            },
        );
        expect(JSON.stringify(log.mock.calls)).not.toContain(apiKey);
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
        const app = new Hono<AppContext>();
        registerAuthAndIntegrationRoutes(app);
        return app;
    }

    function graphUrl(seedSongId: string): string {
        return `/api/music/graph?seedSongId=${encodeURIComponent(seedSongId)}`;
    }

    it("returns a serialized graph and caches successful results by seed", async () => {
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
        });
        expect(secondResponse.status).toBe(200);
        await expect(secondResponse.json()).resolves.toEqual(firstGraph);
        expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it("expires successful cache entries after 15 minutes", async () => {
        const fetcher = graphFetch();
        vi.stubGlobal("fetch", fetcher);
        const now = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(now);
        const app = graphApp();
        const url = graphUrl("lastfm:Band:TtlSeed");

        const firstResponse = await app.request(url, undefined, {
            LASTFM_API_KEY: apiKey,
        } as Env);
        expect(firstResponse.status).toBe(200);
        vi.mocked(Date.now).mockReturnValue(now + 15 * 60 * 1000 + 1);
        const secondResponse = await app.request(url, undefined, {
            LASTFM_API_KEY: apiKey,
        } as Env);

        expect(secondResponse.status).toBe(200);
        expect(fetcher).toHaveBeenCalledTimes(4);
    });

    it("evicts old entries when the 20-entry cache limit is exceeded", async () => {
        const fetcher = graphFetch();
        vi.stubGlobal("fetch", fetcher);
        const app = graphApp();

        for (let index = 0; index < 21; index += 1) {
            const response = await app.request(
                graphUrl(`lastfm:CacheBand${index}:Seed`),
                undefined,
                { LASTFM_API_KEY: apiKey } as Env,
            );
            expect(response.status).toBe(200);
        }

        const firstResponse = await app.request(
            graphUrl("lastfm:CacheBand0:Seed"),
            undefined,
            { LASTFM_API_KEY: apiKey } as Env,
        );

        expect(firstResponse.status).toBe(200);
        expect(fetcher).toHaveBeenCalledTimes(66);
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
        expect(graph.songs).toHaveLength(6);
        expect(graph.edges[0].recommendations).toHaveLength(5);
        expect(fetcher).toHaveBeenCalledTimes(7);
    });

    it("returns 502 for upstream failures and does not cache failed builds", async () => {
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

        expect(failed.status).toBe(502);
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
