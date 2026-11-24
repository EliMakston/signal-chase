import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeGraph } from "./graphAnalysis";
import { findShortestPath } from "./pathfinding";
import {
    RACE_DIFFICULTIES,
    generateRace,
    type RaceDifficulty,
} from "./raceGenerator";
import { deserializeGraph, serializeGraph } from "./graphSerialization";
import type { SongGraph } from "./types";
import {
    demoGraphRegistry,
    getDemoGraphDefinition,
} from "./demoGraphs";
import { MockMusicProvider } from "../services/mockMusicProvider";

const difficulties: RaceDifficulty[] = ["easy", "medium", "hard"];

afterEach(() => {
    vi.unstubAllGlobals();
});

function graphReachableSongCount(graph: SongGraph): number {
    const firstSongId = graph.nodes.keys().next().value;
    if (firstSongId === undefined) return 0;

    const visited = new Set([firstSongId]);
    const queue = [firstSongId];
    for (let index = 0; index < queue.length; index += 1) {
        const songId = queue[index];
        for (const neighborId of graph.edges.get(songId) ?? []) {
            if (!visited.has(neighborId)) {
                visited.add(neighborId);
                queue.push(neighborId);
            }
        }
    }
    return visited.size;
}

describe("curated Demo graph registry", () => {
    it("contains six uniquely identified, explicitly curated networks", () => {
        expect(demoGraphRegistry).toHaveLength(6);
        expect(
            demoGraphRegistry.reduce(
                (total, { graph }) => total + graph.nodes.size,
                0,
            ),
        ).toBe(240);
        expect(new Set(demoGraphRegistry.map(({ id }) => id)).size).toBe(6);
        expect(demoGraphRegistry.map(({ name }) => name)).toEqual([
            "Indie & Alternative",
            "Classic Rock",
            "Pop",
            "Hip-Hop",
            "Electronic",
            "Across the Decades",
        ]);
        expect(demoGraphRegistry.every(({ source }) => source === "curated-demo"))
            .toBe(true);
    });

    it.each(demoGraphRegistry)("$name has a valid, connected graph", (definition) => {
        const { graph, id } = definition;
        const songIds = [...graph.nodes.keys()];
        const analysis = analyzeGraph(graph);

        expect(songIds.length).toBeGreaterThanOrEqual(40);
        expect(songIds.length).toBeLessThanOrEqual(60);
        expect(new Set(songIds).size).toBe(songIds.length);
        expect(songIds.every((songId) => songId.startsWith(`${id}:`))).toBe(true);
        expect([...graph.nodes].every(([songId, song]) => song.id === songId)).toBe(true);
        expect(analysis.ignoredMalformedEntries).toBe(0);
        expect(analysis.totalSongs).toBe(songIds.length);
        expect(analysis.totalDirectedEdges).toBe(160);
        expect(analysis.averageOutgoingDegree).toBe(4);
        expect(analysis.songsWithZeroOutgoingEdges).toBe(0);
        expect(analysis.largestStronglyConnectedComponentSize).toBe(songIds.length);
        expect(graphReachableSongCount(graph)).toBe(songIds.length);
        expect([...graph.edges.keys()]).toEqual(songIds);

        for (const songId of songIds) {
            const neighbors = graph.edges.get(songId);
            expect(neighbors).toBeDefined();
            expect(neighbors!.length).toBeGreaterThanOrEqual(4);
            expect(neighbors!.length).toBeLessThanOrEqual(8);
            expect(new Set(neighbors).size).toBe(neighbors!.length);
            expect(neighbors).not.toContain(songId);
            expect(neighbors!.every((neighborId) => graph.nodes.has(neighborId)))
                .toBe(true);
        }

        const eligibleByDifficulty = Object.fromEntries(
            difficulties.map((difficulty) => {
                const { minMoves, maxMoves } = RACE_DIFFICULTIES[difficulty];
                const count = analysis.qualifyingPairs.filter(
                    ({ shortestPathMoves }) =>
                        shortestPathMoves >= minMoves &&
                        shortestPathMoves <= maxMoves,
                ).length;
                return [difficulty, count];
            }),
        );
        expect(eligibleByDifficulty).toEqual({
            easy: 320,
            medium: 320,
            hard: 320,
        });
        for (const difficulty of difficulties) {
            expect(eligibleByDifficulty[difficulty]).toBeGreaterThan(0);
            const generated = generateRace(graph, {
                difficulty,
                random: () => 0,
            });
            expect(generated).not.toBeNull();
            expect(generated!.optimalMoves).toBeGreaterThanOrEqual(
                RACE_DIFFICULTIES[difficulty].minMoves,
            );
            expect(generated!.optimalMoves).toBeLessThanOrEqual(
                RACE_DIFFICULTIES[difficulty].maxMoves,
            );
            expect(
                findShortestPath(
                    graph,
                    generated!.startSongId,
                    generated!.targetSongId,
                ),
            ).toHaveLength(generated!.optimalMoves + 1);
        }

        expect(analysis.qualifyingPairs.length).toBeGreaterThan(0);
        expect(analysis.qualifyingPairs.length).toBe(640);
        expect(analysis.qualifyingPairsWithTwoRoutes).toBe(640);
        expect(
            analysis.qualifyingPairsWithTwoRoutes /
                analysis.qualifyingPairs.length,
        ).toBeGreaterThanOrEqual(0.8);
    });

    it("loads each graph deterministically without mutating registry state", () => {
        for (const definition of demoGraphRegistry) {
            const first = serializeGraph(definition.graph);
            const second = serializeGraph(getDemoGraphDefinition(definition.id)!.graph);

            expect(second).toEqual(first);
            expect(
                serializeGraph(
                    deserializeGraph(JSON.parse(JSON.stringify(first))),
                ),
            ).toEqual(first);
        }
    });

    it("keeps Demo graph playback local to the supplied curated graph", async () => {
        const definition = demoGraphRegistry[0];
        const provider = new MockMusicProvider(definition.graph);
        const song = definition.graph.nodes.values().next().value;
        const fetcher = vi.fn();
        vi.stubGlobal("fetch", fetcher);
        expect(song).toBeDefined();

        await expect(provider.getSong(song!.id)).resolves.toEqual(song);
        await expect(provider.getSimilarSongs(song!.id)).resolves.toHaveLength(4);
        await expect(provider.searchSongs(song!.title)).resolves.toContainEqual(song);
        expect(fetcher).not.toHaveBeenCalled();
    });
});
