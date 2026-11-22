import { getNeighbors, getSong, mockGraph } from "../game/graph";
import type { SongGraph } from "../game/types";
import type { MusicProvider } from "./musicProvider";

export class MockMusicProvider implements MusicProvider {
    constructor(private readonly graph: SongGraph = mockGraph) {}

    async getSong(songId: string) {
        return getSong(this.graph, songId) ?? null;
    }

    async getSimilarSongs(songId: string) {
        return getNeighbors(this.graph, songId).flatMap((neighborId) => {
            const song = getSong(this.graph, neighborId);
            return song ? [song] : [];
        });
    }

    async searchSongs(query: string) {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        if (!normalizedQuery) {
            return [];
        }

        return [...this.graph.nodes.values()].filter((song) =>
            `${song.title} ${song.artist}`.toLocaleLowerCase().includes(normalizedQuery),
        );
    }
}
