import type { Song, SongGraph } from "../types";

export type CuratedSongRow = readonly [
    slug: string,
    title: string,
    artist: string,
];

export function buildCuratedGraph(
    graphId: string,
    rows: readonly CuratedSongRow[],
): SongGraph {
    if (!/^[a-z0-9-]+$/.test(graphId)) {
        throw new TypeError(`Invalid curated Demo graph ID "${graphId}".`);
    }

    const songs: Song[] = rows.map(([slug, title, artist]) => {
        if (
            !/^[a-z0-9-]+$/.test(slug) ||
            !title.trim() ||
            !artist.trim()
        ) {
            throw new TypeError(`Invalid song entry in curated graph "${graphId}".`);
        }

        return {
            id: `${graphId}:${slug}`,
            title,
            artist,
            albumArt: "",
        };
    });

    const songIds = songs.map((song) => song.id);
    if (new Set(songIds).size !== songIds.length) {
        throw new TypeError(`Duplicate song ID in curated graph "${graphId}".`);
    }
    if (songs.length < 5) {
        throw new RangeError("Curated Demo graphs need at least five songs.");
    }

    const nodes = new Map(songs.map((song) => [song.id, song]));
    const edges = new Map<string, string[]>();
    // Each row is a hand-curated cycle; nearby rows create local alternatives.
    for (let index = 0; index < songIds.length; index += 1) {
        const neighbors = [
            songIds[(index + 1) % songIds.length],
            songIds[(index + songIds.length - 1) % songIds.length],
            songIds[(index + 2) % songIds.length],
            songIds[(index + songIds.length - 2) % songIds.length],
        ];
        edges.set(songIds[index], [...new Set(neighbors)]);
    }

    return { nodes, edges };
}
