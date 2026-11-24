import { describe, expect, it } from "vitest";
import { deserializeGraph, serializeGraph } from "./graphSerialization";
import type { SongGraph } from "./types";

const graph: SongGraph = {
    nodes: new Map([
        ["song:1", {
            id: "song:1",
            title: "First",
            artist: "Artist A",
            albumArt: "first.jpg",
            lastFmUrl: "https://www.last.fm/music/Artist+A/_/First",
        }],
        ["song-2", {
            id: "song-2",
            title: "Second",
            artist: "Artist B",
            albumArt: "",
        }],
        ["song-3", {
            id: "song-3",
            title: "Third",
            artist: "Artist C",
            albumArt: "third.jpg",
        }],
    ]),
    edges: new Map([
        ["song:1", ["song-3", "song-2"]],
        ["song-2", ["song:1"]],
        ["song-3", []],
    ]),
};

describe("graph serialization", () => {
    it("round-trips song metadata, IDs, edge directions, and recommendation order", () => {
        const serialized = serializeGraph(graph);
        const restored = deserializeGraph(JSON.parse(JSON.stringify(serialized)));

        expect([...restored.nodes]).toEqual([...graph.nodes]);
        expect([...restored.edges]).toEqual([...graph.edges]);
    });

    it("rejects values without song and edge arrays", () => {
        expect(() => deserializeGraph({ songs: [], edges: {} })).toThrow(
            "Serialized graph must contain songs and edges arrays.",
        );
    });

    it("rejects malformed song metadata", () => {
        expect(() =>
            deserializeGraph({
                songs: [{ id: "song-1", title: "Only a title" }],
                edges: [],
            }),
        ).toThrow("Serialized graph contains an invalid song.");
    });

    it("rejects duplicate song IDs", () => {
        const song = {
            id: "song-1",
            title: "Track",
            artist: "Artist",
            albumArt: "",
        };

        expect(() =>
            deserializeGraph({ songs: [song, song], edges: [] }),
        ).toThrow('Serialized graph contains duplicate song ID "song-1".');
    });

    it("rejects edge sources without a corresponding song", () => {
        expect(() =>
            deserializeGraph({
                songs: [],
                edges: [{ songId: "missing", recommendations: [] }],
            }),
        ).toThrow('Serialized graph contains an edge source without a song "missing".');
    });

    it("rejects edges that point to missing songs", () => {
        expect(() =>
            deserializeGraph({
                songs: [
                    { id: "song-1", title: "Track", artist: "Artist", albumArt: "" },
                ],
                edges: [{ songId: "song-1", recommendations: ["missing"] }],
            }),
        ).toThrow('Serialized graph edge points to missing song "missing".');
    });

    it("rejects duplicate edge sources and malformed recommendation IDs", () => {
        const song = {
            id: "song-1",
            title: "Track",
            artist: "Artist",
            albumArt: "",
        };

        expect(() =>
            deserializeGraph({
                songs: [song],
                edges: [
                    { songId: "song-1", recommendations: [] },
                    { songId: "song-1", recommendations: [] },
                ],
            }),
        ).toThrow('Serialized graph contains duplicate edge source "song-1".');
        expect(() =>
            deserializeGraph({
                songs: [song],
                edges: [{ songId: "song-1", recommendations: [3] }],
            }),
        ).toThrow("Serialized graph contains an invalid edge entry.");
    });

    it("creates empty adjacency lists for songs omitted from edges", () => {
        const restored = deserializeGraph({
            songs: [
                { id: "song-1", title: "Track", artist: "Artist", albumArt: "" },
            ],
            edges: [],
        });

        expect(restored.edges.get("song-1")).toEqual([]);
    });
});
