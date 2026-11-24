import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LastFmAttribution, LastFmTrackLink } from "./LastFmTrackLink";

describe("Last.fm presentation", () => {
    it("renders a safe catalogue link as a separate external control", () => {
        const markup = renderToStaticMarkup(
            <div>
                <button type="button">Select song</button>
                <LastFmTrackLink
                    url="https://www.last.fm/music/M83/_/Midnight+City"
                    title="Midnight City"
                    artist="M83"
                />
            </div>,
        );

        expect(markup).toContain('target="_blank"');
        expect(markup).toContain('rel="noopener noreferrer"');
        expect(markup).toContain('aria-label="View Midnight City by M83 on Last.fm"');
        expect(markup).toContain("</button><a");
        expect(markup.indexOf("</button>")).toBeLessThan(markup.indexOf("<a"));
    });

    it("omits untrusted catalogue links", () => {
        const markup = renderToStaticMarkup(
            <LastFmTrackLink
                url="https://evil.example/redirect"
                title="Track"
                artist="Artist"
            />,
        );
        expect(markup).toBe("");
    });

    it("renders a clearly reserved official attribution-button placement", () => {
        const markup = renderToStaticMarkup(<LastFmAttribution active />);
        expect(markup).toContain('aria-label="Last.fm attribution"');
        expect(markup).toContain('data-testid="lastfm-attribution-button-slot"');
        expect(markup).toContain(
            "Official attribution button required before public activation",
        );
    });

    it("does not render Last.fm attribution for a Demo display", () => {
        expect(
            renderToStaticMarkup(<LastFmAttribution active={false} />),
        ).toBe("");
    });

});
