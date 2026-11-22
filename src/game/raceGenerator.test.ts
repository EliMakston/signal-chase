import { describe, expect, it } from "vitest";
import { generateRace } from "./raceGenerator";
import type { Song, SongGraph } from "./types";

function createGraph(edges: Array<[string, string[]]>): SongGraph {
    const songIds = new Set(edges.map(([songId]) => songId));
    for (const [, neighbors] of edges) {
        for (const neighborId of neighbors) {
            songIds.add(neighborId);
        }
    }

    const songs: Song[] = [...songIds].map((id) => ({
        id,
        title: id,
        artist: "Test Artist",
        albumArt: "",
    }));

    return {
        nodes: new Map(songs.map((song) => [song.id, song])),
        edges: new Map(edges),
    };
}

describe("generateRace", () => {
    const graph = createGraph([
        ["a", ["b", "c"]],
        ["b", ["c"]],
        ["c", ["d"]],
        ["d", ["e"]],
        ["e", []],
    ]);

    it("generates a distinct, reachable race with the default move range", () => {
        const race = generateRace(graph, { random: () => 0 });

        expect(race).not.toBeNull();
        expect(race?.startSongId).not.toBe(race?.targetSongId);
        expect(race?.optimalMoves).toBeGreaterThanOrEqual(2);
        expect(race?.optimalMoves).toBeLessThanOrEqual(5);
        expect(graph.nodes.has(race!.startSongId)).toBe(true);
        expect(graph.nodes.has(race!.targetSongId)).toBe(true);
    });

    it("respects configured minimum and maximum shortest-path lengths", () => {
        const race = generateRace(graph, {
            minMoves: 3,
            maxMoves: 3,
            random: () => 0,
        });

        expect(race).toEqual({
            startSongId: "a",
            targetSongId: "e",
            optimalMoves: 3,
        });
    });

    it("respects directional edges when selecting a reachable target", () => {
        const oneWayGraph = createGraph([
            ["start", ["middle"]],
            ["middle", []],
            ["target", ["start"]],
        ]);
        const race = generateRace(oneWayGraph, {
            minMoves: 1,
            maxMoves: 1,
            random: () => 0,
        });

        expect(race).toEqual({
            startSongId: "start",
            targetSongId: "middle",
            optimalMoves: 1,
        });
    });

    it("returns null when the graph has no valid reachable pair", () => {
        const graphWithoutReachablePairs = createGraph([
            ["isolated-a", []],
            ["isolated-b", []],
        ]);

        expect(generateRace(graphWithoutReachablePairs)).toBeNull();
    });

    it("returns null for an empty graph", () => {
        expect(
            generateRace({ nodes: new Map(), edges: new Map() }),
        ).toBeNull();
    });

    it("returns null when the requested constraints are impossible", () => {
        expect(
            generateRace(graph, {
                minMoves: 10,
                maxMoves: 12,
                random: () => 0,
            }),
        ).toBeNull();
    });

    it("selects candidates deterministically using the injected random function", () => {
        const firstRace = generateRace(graph, { random: () => 0 });
        const lastRace = generateRace(graph, { random: () => 0.999999 });

        expect(firstRace).toEqual({
            startSongId: "a",
            targetSongId: "d",
            optimalMoves: 2,
        });
        expect(lastRace).toEqual({
            startSongId: "c",
            targetSongId: "e",
            optimalMoves: 2,
        });
    });

    it("returns null for invalid move constraints", () => {
        expect(generateRace(graph, { minMoves: 4, maxMoves: 2 })).toBeNull();
        expect(generateRace(graph, { minMoves: -1 })).toBeNull();
    });
});
