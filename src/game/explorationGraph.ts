import { findShortestPath } from "./pathfinding";
import type { Song, SongGraph } from "./types";

export interface ExplorationGraphState {
    readonly originalRaceGraph: SongGraph;
    readonly graph: SongGraph;
    readonly expandedSongIds: ReadonlySet<string>;
    readonly originalShortestPathDistance: number | null;
}

function cloneGraph(graph: SongGraph): SongGraph {
    return {
        nodes: new Map(
            [...graph.nodes].map(([songId, song]) => [songId, { ...song }]),
        ),
        edges: new Map(
            [...graph.edges].map(([songId, recommendations]) => [
                songId,
                [...recommendations],
            ]),
        ),
    };
}

function isSong(value: unknown): value is Song {
    if (typeof value !== "object" || value === null) return false;
    const song = value as Record<string, unknown>;
    return (
        typeof song.id === "string" &&
        song.id.trim().length > 0 &&
        typeof song.title === "string" &&
        typeof song.artist === "string" &&
        typeof song.albumArt === "string"
    );
}

/**
 * Copies the initial race graph and snapshots its shortest-path benchmark.
 * The graph format does not encode expansion state, so callers must pass
 * explicitly known-expanded IDs. When omitted, all songs are considered
 * unexpanded rather than guessing from their outgoing degree.
 */
export function initializeExplorationGraph(
    raceGraph: SongGraph,
    startSongId: string,
    targetSongId: string,
    knownExpandedSongIds: Iterable<string> = [],
): ExplorationGraphState {
    const originalRaceGraph = cloneGraph(raceGraph);
    const graph = cloneGraph(raceGraph);
    const path = findShortestPath(originalRaceGraph, startSongId, targetSongId);

    return {
        originalRaceGraph,
        graph,
        expandedSongIds: new Set(
            [...knownExpandedSongIds].filter((songId) =>
                originalRaceGraph.nodes.has(songId),
            ),
        ),
        originalShortestPathDistance: path ? path.length - 1 : null,
    };
}

export function beginExplorationRace(
    state: ExplorationGraphState,
    startSongId: string,
    targetSongId: string,
): ExplorationGraphState {
    const path = findShortestPath(
        state.originalRaceGraph,
        startSongId,
        targetSongId,
    );
    return {
        ...state,
        originalShortestPathDistance: path ? path.length - 1 : null,
    };
}

export function songRequiresExpansion(
    state: ExplorationGraphState,
    songId: string,
): boolean {
    return state.graph.nodes.has(songId) && !state.expandedSongIds.has(songId);
}

/**
 * Adds recommendations in provider order, retaining existing metadata and
 * edges for known IDs. Expansion status is marked separately so an empty
 * successful response can be distinguished from an unrequested song.
 */
export function mergeRecommendations(
    state: ExplorationGraphState,
    songId: string,
    recommendations: readonly Song[],
): ExplorationGraphState {
    if (!state.graph.nodes.has(songId)) {
        throw new RangeError(`Cannot add recommendations for unknown song "${songId}".`);
    }

    const nodes = new Map(state.graph.nodes);
    const edges = new Map(
        [...state.graph.edges].map(([sourceId, targetIds]) => [
            sourceId,
            [...targetIds],
        ]),
    );
    const seen = new Set<string>();
    const outgoing: string[] = [];
    for (const targetId of edges.get(songId) ?? []) {
        if (seen.has(targetId) || !nodes.has(targetId)) continue;
        seen.add(targetId);
        outgoing.push(targetId);
    }

    for (const recommendation of recommendations) {
        if (!isSong(recommendation)) {
            throw new TypeError("Recommendations must contain valid songs.");
        }

        if (!nodes.has(recommendation.id)) {
            nodes.set(recommendation.id, { ...recommendation });
            edges.set(recommendation.id, []);
        }
        if (!seen.has(recommendation.id)) {
            seen.add(recommendation.id);
            outgoing.push(recommendation.id);
        }
    }

    edges.set(songId, outgoing);
    return {
        ...state,
        graph: { nodes, edges },
    };
}

export function markSongExpanded(
    state: ExplorationGraphState,
    songId: string,
): ExplorationGraphState {
    if (!state.graph.nodes.has(songId)) {
        throw new RangeError(`Cannot mark unknown song "${songId}" as expanded.`);
    }

    const expandedSongIds = new Set(state.expandedSongIds);
    expandedSongIds.add(songId);
    return { ...state, expandedSongIds };
}

export function getAvailableRecommendations(
    state: ExplorationGraphState,
    songId: string,
): Song[] {
    const seen = new Set<string>();
    const songs: Song[] = [];

    for (const targetId of state.graph.edges.get(songId) ?? []) {
        if (seen.has(targetId)) continue;
        const song = state.graph.nodes.get(targetId);
        if (!song) continue;
        seen.add(targetId);
        songs.push(song);
    }

    return songs;
}
