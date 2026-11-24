import { describe, expect, it } from "vitest";
import { analyzeGraph } from "./graphAnalysis";
import type { Song, SongGraph } from "./types";

function graphFromEdges(
    edges: Array<[string, string[]]>,
    extraSongs: string[] = [],
): SongGraph {
    const songIds = new Set(extraSongs);
    for (const [songId, neighbors] of edges) {
        songIds.add(songId);
        for (const neighborId of neighbors) songIds.add(neighborId);
    }
    const songs: Song[] = [...songIds].map((id) => ({
        id,
        title: `Title ${id}`,
        artist: `Artist ${id}`,
        albumArt: "",
    }));

    return {
        nodes: new Map(songs.map((song) => [song.id, song])),
        edges: new Map(edges),
    };
}

describe("analyzeGraph", () => {
    it("calculates directed degree metrics and strongly connected components", () => {
        const graph = graphFromEdges([
            ["a", ["b", "c"]],
            ["b", ["c"]],
            ["c", ["a"]],
        ], ["isolated"]);

        const analysis = analyzeGraph(graph);

        expect(analysis).toMatchObject({
            totalSongs: 4,
            totalDirectedEdges: 4,
            songsWithZeroOutgoingEdges: 1,
            zeroOutgoingPercentage: 25,
            averageOutgoingDegree: 1,
            maximumOutgoingDegree: 2,
            songsWithAtLeastTwoOutgoingEdges: 1,
            stronglyConnectedComponentSizes: [3, 1],
            largestStronglyConnectedComponentSize: 3,
        });
    });

    it("returns zero-safe metrics for an empty graph", () => {
        expect(
            analyzeGraph({ nodes: new Map(), edges: new Map() }),
        ).toMatchObject({
            totalSongs: 0,
            totalDirectedEdges: 0,
            songsWithZeroOutgoingEdges: 0,
            zeroOutgoingPercentage: 0,
            averageOutgoingDegree: 0,
            maximumOutgoingDegree: 0,
            stronglyConnectedComponentSizes: [],
            largestStronglyConnectedComponentSize: 0,
            qualifyingPairs: [],
        });
    });

    it("counts directed reachable ordered pairs at distances 2 through 5", () => {
        const graph = graphFromEdges([
            ["a", ["b"]],
            ["b", ["c"]],
            ["c", ["d"]],
            ["d", ["e"]],
            ["e", ["f"]],
            ["f", []],
        ]);

        const analysis = analyzeGraph(graph);
        const pairs = analysis.qualifyingPairs.map(
            ({ startSongId, targetSongId, shortestPathMoves }) =>
                `${startSongId}:${targetSongId}:${shortestPathMoves}`,
        );

        expect(pairs).toEqual([
            "a:c:2",
            "a:d:3",
            "a:e:4",
            "a:f:5",
            "b:d:2",
            "b:e:3",
            "b:f:4",
            "c:e:2",
            "c:f:3",
            "d:f:2",
        ]);
        expect(analysis.qualifyingPairs).toHaveLength(10);
    });

    it("does not infer reverse reachability for directed edges", () => {
        const graph = graphFromEdges([
            ["a", ["b"]],
            ["b", ["c"]],
            ["c", []],
        ]);

        const pairs = analyzeGraph(graph).qualifyingPairs;
        expect(pairs).toEqual([
            expect.objectContaining({
                startSongId: "a",
                targetSongId: "c",
                shortestPathMoves: 2,
            }),
        ]);
    });

    it("recognizes two simple routes and counts qualifying pairs with alternatives", () => {
        const graph = graphFromEdges([
            ["a", ["b", "c"]],
            ["b", ["d"]],
            ["c", ["d"]],
            ["d", ["e"]],
            ["e", []],
        ]);

        const analysis = analyzeGraph(graph);

        expect(analysis.qualifyingPairs).toContainEqual({
            startSongId: "a",
            targetSongId: "d",
            shortestPathMoves: 2,
            hasTwoSimpleRoutesWithinSevenMoves: true,
        });
        expect(analysis.qualifyingPairsWithTwoRoutes).toBeGreaterThan(0);
    });

    it("does not count a single simple route, even when cycles offer walks", () => {
        const graph = graphFromEdges([
            ["a", ["b"]],
            ["b", ["a", "c"]],
            ["c", []],
        ]);

        const pair = analyzeGraph(graph).qualifyingPairs.find(
            (candidate) =>
                candidate.startSongId === "a" && candidate.targetSongId === "c",
        );

        expect(pair).toEqual({
            startSongId: "a",
            targetSongId: "c",
            shortestPathMoves: 2,
            hasTwoSimpleRoutesWithinSevenMoves: false,
        });
    });

    it("counts alternate simple routes at seven moves but excludes longer routes", () => {
        const withinLimit = graphFromEdges([
            ["start", ["short", "long-1"]],
            ["short", ["target"]],
            ["long-1", ["long-2"]],
            ["long-2", ["long-3"]],
            ["long-3", ["long-4"]],
            ["long-4", ["long-5"]],
            ["long-5", ["long-6"]],
            ["long-6", ["target"]],
        ]);
        const beyondLimit = graphFromEdges([
            ["start", ["short", "long-1"]],
            ["short", ["target"]],
            ["long-1", ["long-2"]],
            ["long-2", ["long-3"]],
            ["long-3", ["long-4"]],
            ["long-4", ["long-5"]],
            ["long-5", ["long-6"]],
            ["long-6", ["long-7"]],
            ["long-7", ["target"]],
        ]);

        const findPair = (graph: SongGraph) =>
            analyzeGraph(graph).qualifyingPairs.find(
                (pair) =>
                    pair.startSongId === "start" &&
                    pair.targetSongId === "target",
            );

        expect(findPair(withinLimit)?.hasTwoSimpleRoutesWithinSevenMoves).toBe(true);
        expect(findPair(beyondLimit)?.hasTwoSimpleRoutesWithinSevenMoves).toBe(false);
    });

    it("handles malformed nodes, edge lists, duplicates, and missing targets defensively", () => {
        const malformed = {
            nodes: new Map<unknown, unknown>([
                ["a", { id: "a", title: "A", artist: "Band", albumArt: "" }],
                ["broken", { id: "other", title: "Bad", artist: "Band", albumArt: "" }],
                ["b", { id: "b", title: "B", artist: "Band", albumArt: "" }],
            ]),
            edges: new Map<unknown, unknown>([
                ["a", ["b", "missing", "b", null]],
                ["b", "not-an-array"],
                ["missing-source", ["a"]],
            ]),
        } as unknown as SongGraph;

        expect(analyzeGraph(malformed)).toMatchObject({
            totalSongs: 2,
            totalDirectedEdges: 1,
            songsWithZeroOutgoingEdges: 1,
            ignoredMalformedEntries: 6,
        });
    });

    it("handles graphs with missing edge entries as songs with zero outgoing edges", () => {
        const graph = graphFromEdges([], ["a", "b"]);
        const analysis = analyzeGraph(graph);

        expect(analysis.songsWithZeroOutgoingEdges).toBe(2);
        expect(analysis.stronglyConnectedComponentSizes).toEqual([1, 1]);
    });
});
