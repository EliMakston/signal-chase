import type { Song } from "../../game/types";
import { isCanonicalLastFmSongId } from "../../game/songIds";
import {
    getPlayerFacingErrorMessage,
    getMusicServiceErrorMessage,
    PlayerFacingError,
} from "./playerFacingError";

export type SongSearchStatus = "idle" | "loading" | "empty" | "results" | "error";

export interface SongSearchState {
    status: SongSearchStatus;
    songs: Song[];
    error: string | null;
}

function normalizeQuery(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function searchLocalSongs(
    songs: readonly Song[],
    query: string,
): Song[] {
    const normalizedQuery = normalizeQuery(query);
    if (!normalizedQuery) return [...songs];

    return songs
        .map((song, index) => {
            const title = normalizeQuery(song.title);
            const artist = normalizeQuery(song.artist);
            return {
                song,
                index,
                exact: title === normalizedQuery || artist === normalizedQuery,
                matches:
                    title.includes(normalizedQuery) ||
                    artist.includes(normalizedQuery),
            };
        })
        .filter(({ matches }) => matches)
        .sort(
            (left, right) =>
                Number(right.exact) - Number(left.exact) ||
                left.index - right.index,
        )
        .map(({ song }) => song);
}

export const EMPTY_SONG_SEARCH: SongSearchState = {
    status: "idle",
    songs: [],
    error: null,
};

function isSong(value: unknown): value is Song {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const song = value as Record<string, unknown>;
    return (
        typeof song.id === "string" &&
        isCanonicalLastFmSongId(song.id) &&
        typeof song.title === "string" &&
        song.title.trim().length > 0 &&
        typeof song.artist === "string" &&
        song.artist.trim().length > 0 &&
        typeof song.albumArt === "string"
    );
}

export async function fetchSongSearchResults(
    query: string,
    fetcher: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<Song[]> {
    const params = new URLSearchParams({ query: query.trim() });
    const response = await fetcher.call(
        globalThis,
        `/api/music/search?${params.toString()}`,
        { signal },
    );
    if (!response.ok) {
        const detail = await getMusicServiceErrorMessage(
            response,
            "Song search is temporarily unavailable.",
        );
        throw new PlayerFacingError(detail);
    }

    const payload: unknown = await response.json();
    if (
        typeof payload !== "object" ||
        payload === null ||
        Array.isArray(payload) ||
        !("songs" in payload) ||
        !Array.isArray(payload.songs) ||
        !payload.songs.every(isSong)
    ) {
        throw new PlayerFacingError(
            "Song-search response must contain valid songs. Please retry.",
        );
    }

    const uniqueSongs = new Map<string, Song>();
    for (const song of payload.songs) {
        if (!uniqueSongs.has(song.id)) uniqueSongs.set(song.id, { ...song });
    }
    return [...uniqueSongs.values()];
}

export function createSongSearchController(
    fetcher: typeof fetch = fetch,
    debounceMs = 300,
): {
    search(query: string, update: (state: SongSearchState) => void): () => void;
} {
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    function cancel() {
        generation += 1;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        controller?.abort();
        controller = undefined;
    }

    return {
        search(query, update) {
            cancel();
            const currentGeneration = generation;
            const trimmedQuery = query.trim();
            if (!trimmedQuery) {
                update(EMPTY_SONG_SEARCH);
                return cancel;
            }

            update({ status: "loading", songs: [], error: null });
            timer = setTimeout(() => {
                const requestController = new AbortController();
                controller = requestController;
                void fetchSongSearchResults(
                    trimmedQuery,
                    fetcher,
                    requestController.signal,
                ).then(
                    (songs) => {
                        if (generation !== currentGeneration) return;
                        update({
                            status: songs.length ? "results" : "empty",
                            songs,
                            error: null,
                        });
                    },
                    (error: unknown) => {
                        if (
                            generation !== currentGeneration ||
                            requestController.signal.aborted
                        ) {
                            return;
                        }
                        update({
                            status: "error",
                            songs: [],
                            error: getPlayerFacingErrorMessage(
                                error,
                                "Could not reach song search. Check your connection and retry.",
                            ),
                        });
                    },
                );
            }, debounceMs);

            return cancel;
        },
    };
}
