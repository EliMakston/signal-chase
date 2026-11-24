import type { Song, SongGraph } from "./types";

export interface SerializedSongGraph {
    songs: Song[];
    edges: Array<{
        songId: string;
        recommendations: string[];
    }>;
    expandedSongIds?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSong(value: unknown): value is Song {
    return (
        isRecord(value) &&
        typeof value.id === "string" &&
        value.id.trim().length > 0 &&
        typeof value.title === "string" &&
        typeof value.artist === "string" &&
        typeof value.albumArt === "string"
    );
}

export function serializeGraph(graph: SongGraph): SerializedSongGraph {
    return {
        songs: [...graph.nodes.values()].map((song) => ({ ...song })),
        edges: [...graph.edges].map(([songId, recommendations]) => ({
            songId,
            recommendations: [...recommendations],
        })),
    };
}

export function deserializeGraph(value: unknown): SongGraph {
    if (!isRecord(value) || !Array.isArray(value.songs) || !Array.isArray(value.edges)) {
        throw new TypeError("Serialized graph must contain songs and edges arrays.");
    }

    const nodes = new Map<string, Song>();
    for (const song of value.songs) {
        if (!isSong(song)) {
            throw new TypeError("Serialized graph contains an invalid song.");
        }
        if (nodes.has(song.id)) {
            throw new TypeError(`Serialized graph contains duplicate song ID "${song.id}".`);
        }
        nodes.set(song.id, { ...song });
    }

    const edges = new Map<string, string[]>();
    for (const edge of value.edges) {
        if (
            !isRecord(edge) ||
            typeof edge.songId !== "string" ||
            !Array.isArray(edge.recommendations) ||
            !edge.recommendations.every((id) => typeof id === "string")
        ) {
            throw new TypeError("Serialized graph contains an invalid edge entry.");
        }
        if (!nodes.has(edge.songId)) {
            throw new TypeError(
                `Serialized graph contains an edge source without a song "${edge.songId}".`,
            );
        }
        if (edges.has(edge.songId)) {
            throw new TypeError(
                `Serialized graph contains duplicate edge source "${edge.songId}".`,
            );
        }
        for (const targetId of edge.recommendations) {
            if (!nodes.has(targetId)) {
                throw new TypeError(
                    `Serialized graph edge points to missing song "${targetId}".`,
                );
            }
        }

        edges.set(edge.songId, [...edge.recommendations]);
    }

    for (const songId of nodes.keys()) {
        if (!edges.has(songId)) {
            edges.set(songId, []);
        }
    }

    return { nodes, edges };
}
