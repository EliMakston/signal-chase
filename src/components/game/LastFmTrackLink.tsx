import { getSafeLastFmTrackUrl } from "../../game/lastFmUrl";

export function LastFmTrackLink({
    url,
    title,
    artist,
}: {
    url: unknown;
    title: string;
    artist: string;
}) {
    const safeUrl = getSafeLastFmTrackUrl(url);
    if (!safeUrl) return null;

    return (
        <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${title} by ${artist} on Last.fm`}
            className="radio-lastfm-track-link"
        >
            View on Last.fm
            <span aria-hidden="true"> ↗</span>
        </a>
    );
}

export function LastFmAttribution({ active }: { active: boolean }) {
    if (!active) return null;

    return (
        <aside
            className="radio-lastfm-attribution"
            aria-label="Last.fm attribution"
        >
            <span className="radio-technical-label">
                Live catalogue data · Last.fm
            </span>
            <div
                className="radio-lastfm-attribution-slot"
                data-testid="lastfm-attribution-button-slot"
                aria-label="Reserved placement for the Last.fm-approved attribution button"
            >
                Official attribution button required before public activation
            </div>
        </aside>
    );
}
