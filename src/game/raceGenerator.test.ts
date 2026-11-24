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

    it("applies Easy, Medium, and Hard preset move ranges", () => {
        const longerGraph = createGraph([
            ["a", ["b"]],
            ["b", ["c"]],
            ["c", ["d"]],
            ["d", ["e"]],
            ["e", ["f"]],
            ["f", []],
        ]);

        for (const [difficulty, minMoves, maxMoves] of [
            ["easy", 2, 3],
            ["medium", 3, 4],
            ["hard", 4, 5],
        ] as const) {
            const race = generateRace(longerGraph, {
                difficulty,
                random: () => 0,
            });
            expect(race?.optimalMoves).toBeGreaterThanOrEqual(minMoves);
            expect(race?.optimalMoves).toBeLessThanOrEqual(maxMoves);
        }
    });

    it("prefers pairs with at least two simple routes within seven moves", () => {
        const graphWithBothKinds = createGraph([
            ["a", ["b", "c"]],
            ["b", ["d"]],
            ["c", ["d"]],
            ["d", []],
            ["x", ["y"]],
            ["y", ["z"]],
            ["z", []],
        ]);

        expect(
            generateRace(graphWithBothKinds, {
                minMoves: 2,
                maxMoves: 2,
                random: () => 0.999,
            }),
        ).toEqual({
            startSongId: "a",
            targetSongId: "d",
            optimalMoves: 2,
        });
    });

    it("falls back to reachable pairs when no candidate has alternative routes", () => {
        const oneRouteGraph = createGraph([
            ["a", ["b"]],
            ["b", ["c"]],
            ["c", []],
        ]);

        expect(
            generateRace(oneRouteGraph, {
                minMoves: 2,
                maxMoves: 2,
                random: () => 0,
            }),
        ).toEqual({
            startSongId: "a",
            targetSongId: "c",
            optimalMoves: 2,
        });
    });

    it("supports explicit constraints alongside a difficulty preset", () => {
        const race = generateRace(graph, {
            difficulty: "easy",
            minMoves: 1,
            maxMoves: 1,
        });

        expect(race).toEqual({
            startSongId: "a",
            targetSongId: "c",
            optimalMoves: 1,
        });
    });

    it("excludes the current pair when selecting a new race", () => {
        const firstRace = {
            startSongId: "a",
            targetSongId: "d",
            optimalMoves: 2,
        };
        const nextRace = generateRace(
            createGraph([
                ["a", ["b", "c"]],
                ["b", ["d"]],
                ["c", ["d"]],
                ["d", []],
                ["x", ["y"]],
                ["y", ["z"]],
                ["z", []],
            ]),
            {
                minMoves: 2,
                maxMoves: 2,
                excludeRace: firstRace,
                random: () => 0,
            },
        );

        expect(nextRace).toEqual({
            startSongId: "x",
            targetSongId: "z",
            optimalMoves: 2,
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

    it("selects qualifying candidates deterministically using the injected random function", () => {
        const firstRace = generateRace(graph, { random: () => 0 });
        const lastRace = generateRace(graph, { random: () => 0.999999 });

        expect(firstRace).toEqual({
            startSongId: "a",
            targetSongId: "d",
            optimalMoves: 2,
        });
        expect(lastRace).toEqual({
            startSongId: "a",
            targetSongId: "e",
            optimalMoves: 3,
        });
    });

    it("returns null for invalid move constraints", () => {
        expect(generateRace(graph, { minMoves: 4, maxMoves: 2 })).toBeNull();
        expect(generateRace(graph, { minMoves: -1 })).toBeNull();
    });
});
