import { describe, expect, it } from "vitest";
import { mockGraph } from "../game/graph";
import { MockMusicProvider } from "./mockMusicProvider";

describe("MockMusicProvider", () => {
    const provider = new MockMusicProvider();

    it("returns a song by ID", async () => {
        await expect(provider.getSong("song-1")).resolves.toEqual(
            mockGraph.nodes.get("song-1"),
        );
    });

    it("returns null for an unknown song ID", async () => {
        await expect(provider.getSong("unknown-song")).resolves.toBeNull();
    });

    it("returns recommended songs in graph order", async () => {
        await expect(provider.getSimilarSongs("song-1")).resolves.toEqual([
            mockGraph.nodes.get("song-2"),
            mockGraph.nodes.get("song-3"),
        ]);
    });

    it("returns an empty list for a song with no recommendations", async () => {
        await expect(provider.getSimilarSongs("song-6")).resolves.toEqual([]);
    });

    it("returns an empty list for an unknown song's recommendations", async () => {
        await expect(provider.getSimilarSongs("unknown-song")).resolves.toEqual(
            [],
        );
    });

    it("searches song titles and artists without case sensitivity", async () => {
        await expect(provider.searchSongs("MIDNIGHT")).resolves.toEqual([
            mockGraph.nodes.get("song-1"),
        ]);
        await expect(provider.searchSongs("m83")).resolves.toEqual([
            mockGraph.nodes.get("song-1"),
        ]);
    });

    it("returns songs in graph order when a query matches multiple songs", async () => {
        await expect(provider.searchSongs("the")).resolves.toEqual([
            mockGraph.nodes.get("song-3"),
            mockGraph.nodes.get("song-8"),
            mockGraph.nodes.get("song-9"),
            mockGraph.nodes.get("song-10"),
        ]);
    });

    it("returns an empty list for blank or unmatched queries", async () => {
        await expect(provider.searchSongs("  ")).resolves.toEqual([]);
        await expect(provider.searchSongs("no matching track")).resolves.toEqual(
            [],
        );
    });
});
