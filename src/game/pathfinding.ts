import { getNeighbors, getSong } from "./graph";
import type { SongGraph } from "./types";

export function findShortestPath(
    graph: SongGraph,
    startSongId: string,
    targetSongId: string,
): string[] | null {
    if (!getSong(graph, startSongId) || !getSong(graph, targetSongId)) {
        return null;
    }

    if (startSongId === targetSongId) {
        return [startSongId];
    }

    const queue = [startSongId];
    const visited = new Set([startSongId]);
    const predecessor = new Map<string, string>();

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
        const currentSongId = queue[queueIndex];

        for (const neighborId of getNeighbors(graph, currentSongId)) {
            if (visited.has(neighborId) || !getSong(graph, neighborId)) {
                continue;
            }

            visited.add(neighborId);
            predecessor.set(neighborId, currentSongId);

            if (neighborId === targetSongId) {
                const path = [targetSongId];
                let pathSongId = targetSongId;

                while (pathSongId !== startSongId) {
                    pathSongId = predecessor.get(pathSongId)!;
                    path.push(pathSongId);
                }

                return path.reverse();
            }

            queue.push(neighborId);
        }
    }

    return null;
}
