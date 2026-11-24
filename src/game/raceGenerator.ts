import {
    analyzeGraph,
    hasTwoSimpleDirectedRoutes,
} from "./graphAnalysis";
import type { QualifyingPairAnalysis } from "./graphAnalysis";
import type { SongGraph } from "./types";

export type RaceDifficulty = "easy" | "medium" | "hard";

export const RACE_DIFFICULTIES: Record<
    RaceDifficulty,
    { minMoves: number; maxMoves: number; label: string }
> = {
    easy: { minMoves: 2, maxMoves: 3, label: "Easy" },
    medium: { minMoves: 3, maxMoves: 4, label: "Medium" },
    hard: { minMoves: 4, maxMoves: 5, label: "Hard" },
};

export const DEFAULT_RACE_DIFFICULTY: RaceDifficulty = "easy";

export function isRaceDifficulty(value: string): value is RaceDifficulty {
    return Object.hasOwn(RACE_DIFFICULTIES, value);
}

export interface RaceGenerationOptions {
    difficulty?: RaceDifficulty;
    minMoves?: number;
    maxMoves?: number;
    random?: () => number;
    excludeRace?: Pick<GeneratedRace, "startSongId" | "targetSongId">;
}

export interface GeneratedRace {
    startSongId: string;
    targetSongId: string;
    optimalMoves: number;
}

interface RaceCandidatePools {
    preferred: GeneratedRace[];
    ordinary: GeneratedRace[];
}

interface GraphCandidateCache {
    analysisPairs: Map<string, QualifyingPairAnalysis>;
    pools: Map<string, RaceCandidatePools>;
}

const candidateCache = new WeakMap<SongGraph, GraphCandidateCache>();

function pairKey(startSongId: string, targetSongId: string): string {
    return JSON.stringify([startSongId, targetSongId]);
}

function getGraphCache(graph: SongGraph): GraphCandidateCache {
    const cached = candidateCache.get(graph);
    if (cached) return cached;

    const analysis = analyzeGraph(graph);
    const result: GraphCandidateCache = {
        analysisPairs: new Map(
            analysis.qualifyingPairs.map((pair) => [
                pairKey(pair.startSongId, pair.targetSongId),
                pair,
            ]),
        ),
        pools: new Map(),
    };
    candidateCache.set(graph, result);
    return result;
}

function getShortestDistances(
    graph: SongGraph,
    startSongId: string,
): Map<string, number> {
    const distances = new Map([[startSongId, 0]]);
    const queue = [startSongId];

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
        const currentSongId = queue[queueIndex];
        const distance = distances.get(currentSongId);
        if (distance === undefined) continue;

        for (const neighborId of graph.edges.get(currentSongId) ?? []) {
            if (!graph.nodes.has(neighborId) || distances.has(neighborId)) continue;
            distances.set(neighborId, distance + 1);
            queue.push(neighborId);
        }
    }

    return distances;
}

function hasOutgoingConnection(graph: SongGraph, songId: string): boolean {
    return (graph.edges.get(songId) ?? []).some((neighborId) =>
        graph.nodes.has(neighborId),
    );
}

function getCandidatePools(
    graph: SongGraph,
    minMoves: number,
    maxMoves: number,
): RaceCandidatePools {
    const cache = getGraphCache(graph);
    const key = `${minMoves}:${maxMoves}`;
    const cachedPools = cache.pools.get(key);
    if (cachedPools) return cachedPools;

    const preferred: GeneratedRace[] = [];
    const ordinary: GeneratedRace[] = [];

    for (const startSongId of graph.nodes.keys()) {
        if (!hasOutgoingConnection(graph, startSongId)) continue;

        const distances = getShortestDistances(graph, startSongId);
        for (const [targetSongId, optimalMoves] of distances) {
            if (
                targetSongId === startSongId ||
                optimalMoves < minMoves ||
                optimalMoves > maxMoves
            ) {
                continue;
            }

            const race = { startSongId, targetSongId, optimalMoves };
            ordinary.push(race);

            const analyzedPair = cache.analysisPairs.get(
                pairKey(startSongId, targetSongId),
            );
            const hasAlternativeRoutes =
                analyzedPair?.hasTwoSimpleRoutesWithinSevenMoves ??
                hasTwoSimpleDirectedRoutes(
                    graph,
                    startSongId,
                    targetSongId,
                );
            if (hasAlternativeRoutes) preferred.push(race);
        }
    }

    const pools = { preferred, ordinary };
    cache.pools.set(key, pools);
    return pools;
}

function isValidMoveRange(minMoves: number, maxMoves: number): boolean {
    return (
        Number.isInteger(minMoves) &&
        Number.isInteger(maxMoves) &&
        minMoves >= 0 &&
        maxMoves >= minMoves
    );
}

export function generateRace(
    graph: SongGraph,
    options: RaceGenerationOptions = {},
): GeneratedRace | null {
    const difficulty = options.difficulty;
    if (difficulty !== undefined && !isRaceDifficulty(difficulty)) {
        return null;
    }

    const preset = difficulty ? RACE_DIFFICULTIES[difficulty] : undefined;
    const minMoves = options.minMoves ?? preset?.minMoves ?? 2;
    const maxMoves = options.maxMoves ?? preset?.maxMoves ?? 5;

    if (!isValidMoveRange(minMoves, maxMoves)) {
        return null;
    }

    const { preferred, ordinary } = getCandidatePools(
        graph,
        minMoves,
        maxMoves,
    );
    const excludeRace = options.excludeRace;
    const isExcluded = (race: GeneratedRace) =>
        race.startSongId === excludeRace?.startSongId &&
        race.targetSongId === excludeRace?.targetSongId;
    const preferredCandidates = preferred.filter((race) => !isExcluded(race));
    const candidates =
        preferredCandidates.length > 0
            ? preferredCandidates
            : ordinary.filter((race) => !isExcluded(race));

    if (candidates.length === 0) return null;

    const random = options.random ?? Math.random;
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
        throw new RangeError("The random function must return a value in [0, 1).");
    }

    return candidates[Math.floor(sample * candidates.length)] ?? null;
}
