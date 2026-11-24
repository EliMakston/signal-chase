import type { Song, SongGraph } from "../game/types";
import type { MusicProvider } from "./musicProvider";

export interface GraphBuildOptions {
    /** Number of recommendation-expansion levels after the seed. Default: 2. */
    maxDepth?: number;
    /** Maximum songs stored in the graph, including the seed. Default: 50. */
    maxSongs?: number;
    /** Maximum recommendations processed for each expanded song. Default: 10. */
    maxRecommendations?: number;
    /** Maximum provider calls, including the initial seed lookup. Default: 50. */
    maxRequests?: number;
}

export interface GraphBuildDiagnostics {
    discoveredSongIds: string[];
    expandedSongIds: string[];
    unexpandedSongIds: string[];
    expandedWithZeroUsableRecommendationsSongIds: string[];
    upstreamRequestCount: number;
    songsOmittedAtSongLimit: number;
    stopReasons: {
        depthLimitSongIds: string[];
        requestLimitSongIds: string[];
        songLimitReached: boolean;
        queueExhausted: boolean;
    };
    durationMs: number;
}

export interface GraphBuildResult {
    graph: SongGraph;
    diagnostics: GraphBuildDiagnostics;
}

export type GraphBuildErrorKind =
    | "seed_not_found"
    | "provider_failure"
    | "invalid_provider_response";

export class GraphBuildError extends Error {
    constructor(
        readonly kind: GraphBuildErrorKind,
        message: string,
        readonly songId: string,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = "GraphBuildError";
    }
}

interface QueueEntry {
    songId: string;
    depth: number;
}

const DEFAULT_OPTIONS: Required<GraphBuildOptions> = {
    maxDepth: 2,
    maxSongs: 50,
    maxRecommendations: 10,
    maxRequests: 50,
};

function isNonNegativeInteger(value: number): boolean {
    return Number.isInteger(value) && value >= 0;
}

function isSong(value: unknown): value is Song {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const song = value as Record<string, unknown>;
    return (
        typeof song.id === "string" &&
        song.id.trim().length > 0 &&
        typeof song.title === "string" &&
        typeof song.artist === "string" &&
        typeof song.albumArt === "string"
    );
}

function validatedOptions(options: GraphBuildOptions): Required<GraphBuildOptions> {
    const result = {
        maxDepth: options.maxDepth ?? DEFAULT_OPTIONS.maxDepth,
        maxSongs: options.maxSongs ?? DEFAULT_OPTIONS.maxSongs,
        maxRecommendations:
            options.maxRecommendations ?? DEFAULT_OPTIONS.maxRecommendations,
        maxRequests: options.maxRequests ?? DEFAULT_OPTIONS.maxRequests,
    };

    if (!isNonNegativeInteger(result.maxDepth)) {
        throw new RangeError("maxDepth must be a non-negative integer.");
    }
    if (!Number.isInteger(result.maxSongs) || result.maxSongs < 1) {
        throw new RangeError("maxSongs must be a positive integer.");
    }
    if (!isNonNegativeInteger(result.maxRecommendations)) {
        throw new RangeError("maxRecommendations must be a non-negative integer.");
    }
    if (!Number.isInteger(result.maxRequests) || result.maxRequests < 1) {
        throw new RangeError("maxRequests must be a positive integer.");
    }

    return result;
}

/**
 * Builds a bounded directed recommendation graph.
 *
 * A missing seed and any provider failure reject with GraphBuildError. When
 * maxRequests is reached during expansion, the graph built so far is returned.
 * The seed lookup counts as the first request.
 */
export async function buildGraph(
    provider: MusicProvider,
    seedSongId: string,
    options: GraphBuildOptions = {},
): Promise<SongGraph> {
    const result = await buildGraphWithDiagnostics(provider, seedSongId, options);
    return result.graph;
}

/**
 * Builds a bounded directed recommendation graph and reports traversal details
 * separately from SongGraph, so callers can retain the public graph format.
 */
export async function buildGraphWithDiagnostics(
    provider: MusicProvider,
    seedSongId: string,
    options: GraphBuildOptions = {},
): Promise<GraphBuildResult> {
    const startedAt = performance.now();
    const limits = validatedOptions(options);
    const nodes = new Map<string, Song>();
    const edges = new Map<string, string[]>();
    const discovered = new Set<string>();
    const expanded = new Set<string>();
    const depthLimitSongIds = new Set<string>();
    const requestLimitSongIds = new Set<string>();
    const expandedWithZeroUsableRecommendations = new Set<string>();
    const queue: QueueEntry[] = [];

    let requestCount = 1;
    let songsOmittedAtSongLimit = 0;
    let requestLimitBlockedExpansion = false;
    let seed: Song | null;
    try {
        seed = await provider.getSong(seedSongId);
    } catch (error) {
        throw new GraphBuildError(
            "provider_failure",
            `Music provider failed to fetch seed "${seedSongId}".`,
            seedSongId,
            { cause: error },
        );
    }

    if (seed === null) {
        throw new GraphBuildError(
            "seed_not_found",
            `Seed song "${seedSongId}" was not found.`,
            seedSongId,
        );
    }
    if (!isSong(seed) || seed.id !== seedSongId) {
        throw new GraphBuildError(
            "invalid_provider_response",
            `Music provider returned invalid seed data for "${seedSongId}".`,
            seedSongId,
        );
    }

    nodes.set(seed.id, { ...seed });
    discovered.add(seed.id);
    queue.push({ songId: seed.id, depth: 0 });

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
        const { songId, depth } = queue[queueIndex];
        if (expanded.has(songId)) continue;
        if (depth >= limits.maxDepth) {
            depthLimitSongIds.add(songId);
            continue;
        }
        if (requestCount >= limits.maxRequests) {
            requestLimitSongIds.add(songId);
            requestLimitBlockedExpansion = true;
            continue;
        }

        expanded.add(songId);
        let recommendations: Song[];
        requestCount += 1;
        try {
            recommendations = await provider.getSimilarSongs(songId);
        } catch (error) {
            throw new GraphBuildError(
                "provider_failure",
                `Music provider failed to fetch recommendations for "${songId}".`,
                songId,
                { cause: error },
            );
        }

        if (!Array.isArray(recommendations)) {
            throw new GraphBuildError(
                "invalid_provider_response",
                `Music provider returned invalid recommendations for "${songId}".`,
                songId,
            );
        }

        const outgoing: string[] = [];
        const seenRecommendations = new Set<string>();
        for (const recommendation of recommendations.slice(
            0,
            limits.maxRecommendations,
        )) {
            if (!isSong(recommendation)) {
                throw new GraphBuildError(
                    "invalid_provider_response",
                    `Music provider returned an invalid recommendation for "${songId}".`,
                    songId,
                );
            }

            const recommendationId = recommendation.id;
            if (seenRecommendations.has(recommendationId)) {
                continue;
            }
            seenRecommendations.add(recommendationId);

            if (!discovered.has(recommendationId)) {
                if (nodes.size >= limits.maxSongs) {
                    songsOmittedAtSongLimit += 1;
                    continue;
                }

                nodes.set(recommendationId, { ...recommendation });
                discovered.add(recommendationId);
                queue.push({ songId: recommendationId, depth: depth + 1 });
            }

            if (nodes.has(recommendationId)) {
                outgoing.push(recommendationId);
            }
        }

        edges.set(songId, outgoing);
        if (outgoing.length === 0) {
            expandedWithZeroUsableRecommendations.add(songId);
        }
    }

    for (const songId of nodes.keys()) {
        if (!edges.has(songId)) {
            edges.set(songId, []);
        }
    }

    const graph = { nodes, edges };
    return {
        graph,
        diagnostics: {
            discoveredSongIds: [...discovered],
            expandedSongIds: [...expanded],
            unexpandedSongIds: [...discovered].filter(
                (songId) => !expanded.has(songId),
            ),
            expandedWithZeroUsableRecommendationsSongIds: [
                ...expandedWithZeroUsableRecommendations,
            ],
            upstreamRequestCount: requestCount,
            songsOmittedAtSongLimit,
            stopReasons: {
                depthLimitSongIds: [...depthLimitSongIds],
                requestLimitSongIds: [...requestLimitSongIds],
                songLimitReached: songsOmittedAtSongLimit > 0,
                queueExhausted: !requestLimitBlockedExpansion,
            },
            durationMs: performance.now() - startedAt,
        },
    };
}
