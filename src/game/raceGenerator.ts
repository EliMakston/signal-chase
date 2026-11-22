import { findShortestPath } from "./pathfinding";
import type { SongGraph } from "./types";

export interface RaceGenerationOptions {
    minMoves?: number;
    maxMoves?: number;
    random?: () => number;
}

export interface GeneratedRace {
    startSongId: string;
    targetSongId: string;
    optimalMoves: number;
}

export function generateRace(
    graph: SongGraph,
    options: RaceGenerationOptions = {},
): GeneratedRace | null {
    const minMoves = options.minMoves ?? 2;
    const maxMoves = options.maxMoves ?? 5;

    if (
        !Number.isInteger(minMoves) ||
        !Number.isInteger(maxMoves) ||
        minMoves < 0 ||
        maxMoves < minMoves
    ) {
        return null;
    }

    const validRaces: GeneratedRace[] = [];

    for (const startSongId of graph.nodes.keys()) {
        for (const targetSongId of graph.nodes.keys()) {
            if (startSongId === targetSongId) {
                continue;
            }

            const path = findShortestPath(graph, startSongId, targetSongId);
            if (!path) {
                continue;
            }

            const optimalMoves = path.length - 1;
            if (optimalMoves >= minMoves && optimalMoves <= maxMoves) {
                validRaces.push({ startSongId, targetSongId, optimalMoves });
            }
        }
    }

    if (validRaces.length === 0) {
        return null;
    }

    const random = options.random ?? Math.random;
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
        throw new RangeError("The random function must return a value in [0, 1).");
    }

    return validRaces[Math.floor(sample * validRaces.length)] ?? null;
}
