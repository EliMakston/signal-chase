import { getNeighbors, getSong } from "./graph";
import type { SongGraph } from "./types";
import type { GameState } from "./gameTypes";

export function createGame(
    graph: SongGraph,
    startSongId: string,
    targetSongId: string,
): GameState {
    if (!getSong(graph, startSongId)) {
        throw new Error(`Starting song "${startSongId}" does not exist.`);
    }

    if (!getSong(graph, targetSongId)) {
        throw new Error(`Target song "${targetSongId}" does not exist.`);
    }

    if (startSongId === targetSongId) {
        throw new Error("Starting and target songs must be different.");
    }

    return {
        startSongId,
        targetSongId,
        currentSongId: startSongId,
        visitedSongs: [startSongId],
        moves: 0,
        status: "playing",
    };
}

export function getAvailableMoves(
    graph: SongGraph,
    gameState: GameState,
): string[] {
    return getNeighbors(graph, gameState.currentSongId).filter(
        (songId) => !gameState.visitedSongs.includes(songId),
    );
}

export function makeMove(
    graph: SongGraph,
    gameState: GameState,
    nextSongId: string,
): GameState | null {
    if (
        gameState.status !== "playing" ||
        !getAvailableMoves(graph, gameState).includes(nextSongId)
    ) {
        return null;
    }

    return {
        ...gameState,
        currentSongId: nextSongId,
        visitedSongs: [...gameState.visitedSongs, nextSongId],
        moves: gameState.moves + 1,
        status: nextSongId === gameState.targetSongId ? "won" : "playing",
    };
}
