export interface Song {
    id: string;
    title: string;
    artist: string;
    albumArt: string;
}

export interface SongGraph {
    nodes: Map<string, Song>;
    edges: Map<string, string[]>;
}