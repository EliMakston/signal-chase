import { describe, expect, it } from "vitest";
import { getSafeLastFmTrackUrl } from "./lastFmUrl";

describe("getSafeLastFmTrackUrl", () => {
    it("preserves HTTPS Last.fm track catalogue URLs", () => {
        const url = "https://www.last.fm/music/M83/_/Midnight+City";

        expect(getSafeLastFmTrackUrl(url)).toBe(url);
        expect(
            getSafeLastFmTrackUrl("https://last.fm/music/M83/_/Midnight+City"),
        ).toBe("https://last.fm/music/M83/_/Midnight+City");
    });

    it.each([
        "http://www.last.fm/music/M83/_/Midnight+City",
        "https://last.fm.evil.example/music/M83/_/Midnight+City",
        "https://evil.last.fm/music/M83/_/Midnight+City",
        "https://www.last.fm/user/example",
        "https://www.last.fm/music/M83/album",
        "https://user@www.last.fm/music/M83/_/Track",
        "https://www.last.fm:8443/music/M83/_/Track",
        "javascript:alert(1)",
        "not a URL",
        `https://www.last.fm/music/Artist%2FInjected/_/Track`,
    ])("rejects non-catalogue or unsafe URL %s", (url) => {
        expect(getSafeLastFmTrackUrl(url)).toBeUndefined();
    });

    it("rejects non-string and excessive-length values", () => {
        expect(getSafeLastFmTrackUrl(null)).toBeUndefined();
        expect(getSafeLastFmTrackUrl({ href: "https://www.last.fm/music/A/_/B" }))
            .toBeUndefined();
        expect(
            getSafeLastFmTrackUrl(
                `https://www.last.fm/music/${"a".repeat(2050)}/_/Track`,
            ),
        ).toBeUndefined();
    });
});
