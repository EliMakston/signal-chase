import { describe, expect, it } from "vitest";
import {
    getNeighbors,
    getSong,
    hasConnection,
    mockGraph,
} from "./graph";

describe("getSong", () => {
    it("returns the requested song", () => {
        expect(getSong(mockGraph, "song-1")).toEqual({
            id: "song-1",
            title: "Midnight City",
            artist: "M83",
            albumArt: "/album-art/midnight-city.jpg",
        });
    });

    it("returns undefined for an invalid song ID", () => {
        expect(getSong(mockGraph, "missing-song")).toBeUndefined();
    });
});

describe("getNeighbors", () => {
    it("returns recommendations for a song", () => {
        expect(getNeighbors(mockGraph, "song-1")).toEqual([
            "song-2",
            "song-3",
        ]);
    });

    it("returns an empty array for a song with no recommendations", () => {
        expect(getNeighbors(mockGraph, "song-6")).toEqual([]);
        expect(getNeighbors(mockGraph, "song-9")).toEqual([]);
    });

    it("returns an empty array for an invalid song ID", () => {
        expect(getNeighbors(mockGraph, "missing-song")).toEqual([]);
    });

    it("does not expose the graph's internal recommendation array", () => {
        const neighbors = getNeighbors(mockGraph, "song-1");
        neighbors.push("song-6");

        expect(getNeighbors(mockGraph, "song-1")).toEqual([
            "song-2",
            "song-3",
        ]);
    });
});

describe("hasConnection", () => {
    it("returns true for a directional connection", () => {
        expect(hasConnection(mockGraph, "song-1", "song-2")).toBe(true);
    });

    it("returns false when the connection is reversed", () => {
        expect(hasConnection(mockGraph, "song-2", "song-1")).toBe(false);
    });

    it("returns false for songs that are not connected", () => {
        expect(hasConnection(mockGraph, "song-6", "song-7")).toBe(false);
    });

    it("returns false for an invalid source or target song ID", () => {
        expect(hasConnection(mockGraph, "missing-song", "song-1")).toBe(false);
        expect(hasConnection(mockGraph, "song-1", "missing-song")).toBe(false);
    });

    it("returns false for a dead end", () => {
        expect(hasConnection(mockGraph, "song-9", "song-10")).toBe(false);
    });
});