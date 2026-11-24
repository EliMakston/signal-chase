import type { GameState } from "../../game/gameTypes";
import type { ExpansionStatus } from "./gameBoardState";
import type { Song } from "../../game/types";

export interface RecommendationPresentationInput {
    expansionStatus: ExpansionStatus;
    isExpanded: boolean;
    availableMoveCount: number;
}

export function getRecommendationPresentation({
    expansionStatus,
    isExpanded,
    availableMoveCount,
}: RecommendationPresentationInput) {
    return {
        loading:
            expansionStatus === "loading" ||
            (expansionStatus === "idle" && !isExpanded),
        error: expansionStatus === "error",
        hasRecommendations: availableMoveCount > 0,
        deadEnd:
            expansionStatus === "idle" &&
            isExpanded &&
            availableMoveCount === 0,
    };
}

export function getBackAvailability(gameState: GameState): {
    enabled: boolean;
    reason: string | null;
} {
    if (gameState.status === "won") {
        return { enabled: false, reason: "Back is unavailable after winning." };
    }
    if (gameState.visitedSongs.length <= 1) {
        return {
            enabled: false,
            reason: "You are at the starting song; there is no previous song.",
        };
    }
    return { enabled: true, reason: null };
}

export function getDeadEndRecoveryAction(
    gameState: GameState,
): "back" | "restart" {
    return gameState.visitedSongs.length > 1 ? "back" : "restart";
}

export interface VictorySummary {
    start: string;
    destination: string;
    moves: number;
    shortestPathMoves: number | null;
}

export function createVictorySummary(
    startSong: Song,
    targetSong: Song,
    gameState: GameState,
    shortestPathMoves: number | null,
): VictorySummary {
    return {
        start: `${startSong.title} by ${startSong.artist}`,
        destination: `${targetSong.title} by ${targetSong.artist}`,
        moves: gameState.moves,
        shortestPathMoves,
    };
}
