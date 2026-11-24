import { describe, expect, it } from "vitest";
import { getAlbumArtworkSource } from "./AlbumArtwork";

describe("getAlbumArtworkSource", () => {
    it("accepts explicitly provided HTTPS and same-origin artwork sources", () => {
        expect(
            getAlbumArtworkSource("https://art.example.test/cover.jpg"),
        ).toBe("https://art.example.test/cover.jpg");
        expect(getAlbumArtworkSource("/album-art/cover.jpg")).toBe(
            "/album-art/cover.jpg",
        );
    });

    it("rejects missing, invalid, and non-HTTPS artwork sources", () => {
        expect(getAlbumArtworkSource("")).toBeNull();
        expect(getAlbumArtworkSource("not-a-url")).toBeNull();
        expect(getAlbumArtworkSource("http://art.example.test/cover.jpg")).toBeNull();
        expect(getAlbumArtworkSource("javascript:alert(1)")).toBeNull();
    });

    it("rejects Last.fm artwork and its generic placeholder image", () => {
        expect(
            getAlbumArtworkSource(
                "https://lastfm.freetls.fastly.net/i/u/300x300/cover.jpg",
            ),
        ).toBeNull();
        expect(
            getAlbumArtworkSource(
                "https://lastfm-img2.akamaized.net/cover.jpg",
            ),
        ).toBeNull();
        expect(
            getAlbumArtworkSource(
                "https://images.example.test/2a96cbd8b46e442fc41c2b86b821562f.png",
            ),
        ).toBeNull();
    });
});
