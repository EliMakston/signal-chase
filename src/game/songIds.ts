export function isCanonicalLastFmSongId(songId: string): boolean {
    const match = /^lastfm:([^:]+):([^:]+)$/.exec(songId);
    if (!match) return false;

    try {
        const artist = decodeURIComponent(match[1]);
        const title = decodeURIComponent(match[2]);
        return (
            artist.trim().length > 0 &&
            title.trim().length > 0 &&
            encodeURIComponent(artist) === match[1] &&
            encodeURIComponent(title) === match[2]
        );
    } catch {
        return false;
    }
}
