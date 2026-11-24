import { describe, expect, it, vi } from "vitest";
import type { Song } from "../game/types";
import type { MusicProvider } from "./musicProvider";
import {
    buildGraph,
    buildGraphWithDiagnostics,
    GraphBuildError,
} from "./graphBuilder";

function song(id: string): Song {
    return {
        id,
        title: `Title ${id}`,
        artist: `Artist ${id}`,
        albumArt: "",
    };
}

class FakeMusicProvider implements MusicProvider {
    readonly getSong = vi.fn<(songId: string) => Promise<Song | null>>();
    readonly getSimilarSongs =
        vi.fn<(songId: string) => Promise<Song[]>>();
    readonly searchSongs = vi.fn<(query: string) => Promise<Song[]>>();

    constructor(
        private readonly songs: Map<string, Song>,
        private readonly recommendations: Map<string, Song[]>,
    ) {
        this.getSong.mockImplementation(
            async (songId) => this.songs.get(songId) ?? null,
        );
        this.getSimilarSongs.mockImplementation(
            async (songId) => this.recommendations.get(songId) ?? [],
        );
        this.searchSongs.mockResolvedValue([]);
    }
}

function providerFor(
    ids: string[],
    recommendations: Record<string, string[]>,
): FakeMusicProvider {
    const songs = new Map(ids.map((id) => [id, song(id)]));
    const recommendationSongs = new Map(
        Object.entries(recommendations).map(([id, relatedIds]) => [
            id,
            relatedIds.map((relatedId) => songs.get(relatedId) ?? song(relatedId)),
        ]),
    );
    return new FakeMusicProvider(songs, recommendationSongs);
}

describe("buildGraph", () => {
    it("reports discovered, expanded, depth-limited, and empty expansions separately", async () => {
        const provider = providerFor(["a", "b", "c", "d"], {
            a: ["b", "c"],
            b: ["d"],
            c: [],
        });

        const { graph, diagnostics } = await buildGraphWithDiagnostics(
            provider,
            "a",
            { maxDepth: 2 },
        );

        expect(graph.nodes.size).toBe(4);
        expect(diagnostics.discoveredSongIds).toEqual(["a", "b", "c", "d"]);
        expect(diagnostics.expandedSongIds).toEqual(["a", "b", "c"]);
        expect(diagnostics.unexpandedSongIds).toEqual(["d"]);
        expect(diagnostics.expandedWithZeroUsableRecommendationsSongIds).toEqual([
            "c",
        ]);
        expect(diagnostics.upstreamRequestCount).toBe(4);
        expect(diagnostics.stopReasons).toEqual({
            depthLimitSongIds: ["d"],
            requestLimitSongIds: [],
            songLimitReached: false,
            queueExhausted: true,
        });
        expect(diagnostics.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("reports song-limit omissions without dropping edges to already discovered songs", async () => {
        const provider = providerFor(["a", "b", "c"], {
            a: ["b", "c"],
            b: ["a", "c"],
        });

        const { graph, diagnostics } = await buildGraphWithDiagnostics(
            provider,
            "a",
            { maxDepth: 2, maxSongs: 2 },
        );

        expect(graph.edges.get("a")).toEqual(["b"]);
        expect(graph.edges.get("b")).toEqual(["a"]);
        expect(diagnostics.songsOmittedAtSongLimit).toBe(2);
        expect(diagnostics.stopReasons.songLimitReached).toBe(true);
    });

    it("reports request-limited songs as unexpanded rather than empty expansions", async () => {
        const provider = providerFor(["a", "b", "c", "d"], {
            a: ["b", "c"],
            b: ["d"],
            c: [],
        });

        const { diagnostics } = await buildGraphWithDiagnostics(
            provider,
            "a",
            { maxDepth: 3, maxRequests: 2 },
        );

        expect(diagnostics.upstreamRequestCount).toBe(2);
        expect(diagnostics.expandedSongIds).toEqual(["a"]);
        expect(diagnostics.unexpandedSongIds).toEqual(["b", "c"]);
        expect(diagnostics.expandedWithZeroUsableRecommendationsSongIds).toEqual(
            [],
        );
        expect(diagnostics.stopReasons).toEqual({
            depthLimitSongIds: [],
            requestLimitSongIds: ["b", "c"],
            songLimitReached: false,
            queueExhausted: false,
        });
    });

    it("reports queue exhaustion when all expanded songs have no recommendations", async () => {
        const provider = providerFor(["a"], { a: [] });
        const { diagnostics } = await buildGraphWithDiagnostics(provider, "a");

        expect(diagnostics.expandedSongIds).toEqual(["a"]);
        expect(
            diagnostics.expandedWithZeroUsableRecommendationsSongIds,
        ).toEqual(["a"]);
        expect(diagnostics.stopReasons).toEqual({
            depthLimitSongIds: [],
            requestLimitSongIds: [],
            songLimitReached: false,
            queueExhausted: true,
        });
    });

    it("builds a directed graph with breadth-first expansion", async () => {
        const provider = providerFor(["a", "b", "c", "d"], {
            a: ["b", "c"],
            b: ["d"],
            c: ["d"],
            d: [],
        });

        const graph = await buildGraph(provider, "a", { maxDepth: 2 });

        expect([...graph.nodes.keys()]).toEqual(["a", "b", "c", "d"]);
        expect([...graph.edges]).toEqual([
            ["a", ["b", "c"]],
            ["b", ["d"]],
            ["c", ["d"]],
            ["d", []],
        ]);
        expect(provider.getSimilarSongs.mock.calls.map(([id]) => id)).toEqual([
            "a",
            "b",
            "c",
        ]);
    });

    it("terminates on cycles and expands each discovered song only once", async () => {
        const provider = providerFor(["a", "b", "c"], {
            a: ["b"],
            b: ["a", "c"],
            c: ["b"],
        });

        const graph = await buildGraph(provider, "a", { maxDepth: 10 });

        expect([...graph.nodes.keys()]).toEqual(["a", "b", "c"]);
        expect(graph.edges.get("a")).toEqual(["b"]);
        expect(graph.edges.get("b")).toEqual(["a", "c"]);
        expect(provider.getSimilarSongs).toHaveBeenCalledTimes(3);
    });

    it("deduplicates duplicate recommendations while preserving first-seen order", async () => {
        const provider = providerFor(["a", "b"], {
            a: ["b", "b", "b"],
            b: [],
        });

        const graph = await buildGraph(provider, "a", { maxDepth: 1 });

        expect(graph.edges.get("a")).toEqual(["b"]);
        expect(graph.nodes.size).toBe(2);
    });

    it("copies provider songs instead of mutating or reusing provider data", async () => {
        const seed = song("a");
        const related = song("b");
        const provider = new FakeMusicProvider(
            new Map([["a", seed]]),
            new Map([["a", [related]]]),
        );

        const graph = await buildGraph(provider, "a", { maxDepth: 1 });
        const storedSeed = graph.nodes.get("a");
        const storedRelated = graph.nodes.get("b");

        expect(storedSeed).not.toBe(seed);
        expect(storedRelated).not.toBe(related);
        storedSeed!.title = "Changed in graph";
        expect(seed.title).toBe("Title a");
        expect(related.title).toBe("Title b");
    });

    it("adds songs at the depth boundary but does not expand them", async () => {
        const provider = providerFor(["a", "b", "c"], {
            a: ["b"],
            b: ["c"],
            c: [],
        });

        const graph = await buildGraph(provider, "a", { maxDepth: 1 });

        expect([...graph.nodes.keys()]).toEqual(["a", "b"]);
        expect(graph.edges.get("a")).toEqual(["b"]);
        expect(graph.edges.get("b")).toEqual([]);
        expect(provider.getSimilarSongs.mock.calls.map(([id]) => id)).toEqual([
            "a",
        ]);
    });

    it("does not store more than maxSongs and never leaves dangling edges", async () => {
        const provider = providerFor(["a", "b", "c", "d"], {
            a: ["b", "c", "d"],
            b: [],
        });

        const graph = await buildGraph(provider, "a", {
            maxDepth: 2,
            maxSongs: 2,
        });

        expect([...graph.nodes.keys()]).toEqual(["a", "b"]);
        expect(graph.edges.get("a")).toEqual(["b"]);
        for (const neighborIds of graph.edges.values()) {
            expect(neighborIds.every((id) => graph.nodes.has(id))).toBe(true);
        }
    });

    it("processes no more than maxRecommendations per song", async () => {
        const provider = providerFor(["a", "b", "c", "d"], {
            a: ["b", "c", "d"],
        });

        const graph = await buildGraph(provider, "a", {
            maxDepth: 1,
            maxRecommendations: 2,
        });

        expect([...graph.nodes.keys()]).toEqual(["a", "b", "c"]);
        expect(graph.edges.get("a")).toEqual(["b", "c"]);
    });

    it("counts the seed lookup against maxRequests and returns the bounded partial graph", async () => {
        const provider = providerFor(["a", "b", "c"], {
            a: ["b"],
            b: ["c"],
            c: [],
        });

        const graph = await buildGraph(provider, "a", {
            maxDepth: 5,
            maxRequests: 2,
        });

        expect(graph.nodes.has("a")).toBe(true);
        expect(graph.nodes.has("b")).toBe(true);
        expect(graph.nodes.has("c")).toBe(false);
        expect(provider.getSong).toHaveBeenCalledTimes(1);
        expect(provider.getSimilarSongs).toHaveBeenCalledTimes(1);
    });

    it("rejects a missing seed with a typed error", async () => {
        const provider = providerFor([], {});

        await expect(buildGraph(provider, "missing")).rejects.toMatchObject({
            name: "GraphBuildError",
            kind: "seed_not_found",
            songId: "missing",
        });
        expect(provider.getSimilarSongs).not.toHaveBeenCalled();
    });

    it("wraps seed and recommendation provider failures predictably", async () => {
        const seedFailure = providerFor([], {});
        seedFailure.getSong.mockRejectedValueOnce(new Error("network"));

        await expect(buildGraph(seedFailure, "a")).rejects.toMatchObject({
            kind: "provider_failure",
            songId: "a",
        });

        const recommendationFailure = providerFor(["a"], {});
        recommendationFailure.getSimilarSongs.mockRejectedValueOnce(
            new Error("network"),
        );

        await expect(buildGraph(recommendationFailure, "a")).rejects.toEqual(
            expect.objectContaining({
                name: "GraphBuildError",
                kind: "provider_failure",
                songId: "a",
            }),
        );
    });

    it("preserves edge direction without inventing reverse edges", async () => {
        const provider = providerFor(["a", "b"], {
            a: ["b"],
            b: [],
        });

        const graph = await buildGraph(provider, "a", { maxDepth: 1 });

        expect(graph.edges.get("a")).toEqual(["b"]);
        expect(graph.edges.get("b")).toEqual([]);
    });

    it("rejects invalid limits before making provider requests", async () => {
        const provider = providerFor(["a"], {});

        await expect(buildGraph(provider, "a", { maxDepth: -1 })).rejects.toThrow(
            RangeError,
        );
        await expect(buildGraph(provider, "a", { maxSongs: 0 })).rejects.toThrow(
            RangeError,
        );
        await expect(
            buildGraph(provider, "a", { maxRecommendations: 1.5 }),
        ).rejects.toThrow(RangeError);
        await expect(buildGraph(provider, "a", { maxRequests: 0 })).rejects.toThrow(
            RangeError,
        );
        expect(provider.getSong).not.toHaveBeenCalled();
    });
});
