import type { Song } from "../game/types";

export interface MusicProvider {
    getSong(songId: string): Promise<Song | null>;
    getSimilarSongs(songId: string): Promise<Song[]>;
    searchSongs(query: string): Promise<Song[]>;
}
