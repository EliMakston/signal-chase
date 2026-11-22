import { describe, expect, it } from "vitest";
import { findShortestPath } from "./pathfinding";
import { mockGraph } from "./graph";
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

describe("findShortestPath", () => {
    it("returns a direct connection", () => {
        expect(findShortestPath(mockGraph, "song-1", "song-2")).toEqual([
            "song-1",
            "song-2",
        ]);
    });

    it("returns a path containing multiple connections", () => {
        expect(findShortestPath(mockGraph, "song-1", "song-9")).toEqual([
            "song-1",
            "song-2",
            "song-4",
            "song-7",
            "song-9",
        ]);
    });

    it("selects the shortest path even when a longer route is discovered first", () => {
        const graph = createGraph([
            ["start", ["long-1", "target"]],
            ["long-1", ["long-2"]],
            ["long-2", ["target"]],
            ["target", []],
        ]);

        expect(findShortestPath(graph, "start", "target")).toEqual([
            "start",
            "target",
        ]);
    });

    it("returns null when no route is available", () => {
        expect(findShortestPath(mockGraph, "song-6", "song-7")).toBeNull();
    });

    it("returns null when the starting song does not exist", () => {
        expect(findShortestPath(mockGraph, "missing-song", "song-1")).toBeNull();
    });

    it("returns null when the target song does not exist", () => {
        expect(findShortestPath(mockGraph, "song-1", "missing-song")).toBeNull();
    });

    it("returns the song itself when start and target are identical", () => {
        expect(findShortestPath(mockGraph, "song-6", "song-6")).toEqual([
            "song-6",
        ]);
    });

    it("terminates on cycles and returns a reachable path", () => {
        const graph = createGraph([
            ["start", ["middle"]],
            ["middle", ["start", "target"]],
            ["target", ["middle"]],
        ]);

        expect(findShortestPath(graph, "start", "target")).toEqual([
            "start",
            "middle",
            "target",
        ]);
    });

    it("respects directional connections", () => {
        const graph = createGraph([
            ["start", []],
            ["target", ["start"]],
        ]);

        expect(findShortestPath(graph, "start", "target")).toBeNull();
        expect(findShortestPath(graph, "target", "start")).toEqual([
            "target",
            "start",
        ]);
    });

    it("preserves neighbor ordering when equally short paths exist", () => {
        const graph = createGraph([
            ["start", ["first", "second"]],
            ["first", ["target"]],
            ["second", ["target"]],
            ["target", []],
        ]);

        expect(findShortestPath(graph, "start", "target")).toEqual([
            "start",
            "first",
            "target",
        ]);
    });
});
