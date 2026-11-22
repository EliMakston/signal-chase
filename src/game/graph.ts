import type { Song, SongGraph } from "./types";

const songs: Song[] = [
    {
        id: "song-1",
        title: "Midnight City",
        artist: "M83",
        albumArt: "/album-art/midnight-city.jpg",
    },
    {
        id: "song-2",
        title: "Electric Feel",
        artist: "MGMT",
        albumArt: "/album-art/electric-feel.jpg",
    },
    {
        id: "song-3",
        title: "The Less I Know the Better",
        artist: "Tame Impala",
        albumArt: "/album-art/the-less-i-know-the-better.jpg",
    },
    {
        id: "song-4",
        title: "Take on Me",
        artist: "a-ha",
        albumArt: "/album-art/take-on-me.jpg",
    },
    {
        id: "song-5",
        title: "Dreams",
        artist: "Fleetwood Mac",
        albumArt: "/album-art/dreams.jpg",
    },
    {
        id: "song-6",
        title: "Pink + White",
        artist: "Frank Ocean",
        albumArt: "/album-art/pink-and-white.jpg",
    },
    {
        id: "song-7",
        title: "Tongue Tied",
        artist: "Grouplove",
        albumArt: "/album-art/tongue-tied.jpg",
    },
    {
        id: "song-8",
        title: "Sweater Weather",
        artist: "The Neighbourhood",
        albumArt: "/album-art/sweater-weather.jpg",
    },
    {
        id: "song-9",
        title: "There Is a Light That Never Goes Out",
        artist: "The Smiths",
        albumArt: "/album-art/there-is-a-light.jpg",
    },
    {
        id: "song-10",
        title: "Everybody Wants to Rule the World",
        artist: "Tears for Fears",
        albumArt: "/album-art/everybody-wants-to-rule-the-world.jpg",
    },
];

export const mockGraph: SongGraph = {
    nodes: new Map(songs.map((song) => [song.id, song])),
    edges: new Map([
        ["song-1", ["song-2", "song-3"]],
        ["song-2", ["song-4", "song-5"]],
        ["song-3", ["song-5", "song-6"]],
        ["song-4", ["song-7"]],
        ["song-5", ["song-7", "song-8"]],
        ["song-6", []],
        ["song-7", ["song-9"]],
        ["song-8", ["song-10"]],
        ["song-9", []],
        ["song-10", ["song-1"]],
    ]),
};

export const songGraph = mockGraph;

export function getSong(graph: SongGraph, songId: string): Song | undefined {
    return graph.nodes.get(songId);
}

export function getNeighbors(graph: SongGraph, songId: string): string[] {
    return [...(graph.edges.get(songId) ?? [])];
}

export function hasConnection(
    graph: SongGraph,
    fromSongId: string,
    toSongId: string,
): boolean {
    return graph.edges.get(fromSongId)?.includes(toSongId) ?? false;
}