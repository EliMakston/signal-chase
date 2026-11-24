import { describe, expect, it } from "vitest";
import { createGame } from "../../game/gameEngine";
import { mockGraph } from "../../game/graph";
import {
    createVictorySummary,
    getBackAvailability,
    getDeadEndRecoveryAction,
    getRecommendationPresentation,
} from "./gameBoardPresentation";

describe("game board presentation", () => {
    it("does not present a dead end while recommendations are loading or failed", () => {
        expect(
            getRecommendationPresentation({
                expansionStatus: "loading",
                isExpanded: false,
                availableMoveCount: 0,
            }),
        ).toMatchObject({ loading: true, error: false, deadEnd: false });
        expect(
            getRecommendationPresentation({
                expansionStatus: "error",
                isExpanded: false,
                availableMoveCount: 0,
            }),
        ).toMatchObject({ loading: false, error: true, deadEnd: false });
    });

    it("waits for the initial expansion effect before presenting a dead end", () => {
        expect(
            getRecommendationPresentation({
                expansionStatus: "idle",
                isExpanded: false,
                availableMoveCount: 0,
            }),
        ).toMatchObject({ loading: true, deadEnd: false });
    });

    it("presents a dead end only after successful expansion with no available moves", () => {
        expect(
            getRecommendationPresentation({
                expansionStatus: "idle",
                isExpanded: true,
                availableMoveCount: 0,
            }),
        ).toMatchObject({ loading: false, error: false, deadEnd: true });
        expect(
            getRecommendationPresentation({
                expansionStatus: "idle",
                isExpanded: true,
                availableMoveCount: 2,
            }),
        ).toMatchObject({
            hasRecommendations: true,
            deadEnd: false,
        });
    });

    it("shows a clear victory summary with a known random benchmark", () => {
        const gameState = createGame(mockGraph, "song-1", "song-4");
        const oneMoveFromWin = {
            ...gameState,
            currentSongId: "song-2",
            visitedSongs: ["song-1", "song-2"],
            moves: 1,
        };
        const summary = createVictorySummary(
            mockGraph.nodes.get("song-1")!,
            mockGraph.nodes.get("song-4")!,
            oneMoveFromWin,
            2,
        );

        expect(summary).toEqual({
            start: "Midnight City by M83",
            destination: "Take on Me by a-ha",
            moves: 1,
            shortestPathMoves: 2,
        });
    });

    it("keeps the custom-race shortest-path benchmark explicitly unknown", () => {
        const gameState = createGame(mockGraph, "song-1", "song-4");
        const summary = createVictorySummary(
            mockGraph.nodes.get("song-1")!,
            mockGraph.nodes.get("song-4")!,
            { ...gameState, moves: 3 },
            null,
        );

        expect(summary.shortestPathMoves).toBeNull();
        expect(summary.moves).toBe(3);
    });

    it("explains when Back is unavailable and selects appropriate dead-end recovery", () => {
        const initial = createGame(mockGraph, "song-1", "song-4");
        expect(getBackAvailability(initial)).toEqual({
            enabled: false,
            reason: "You are at the starting song; there is no previous song.",
        });
        expect(getDeadEndRecoveryAction(initial)).toBe("restart");

        const moved = {
            ...initial,
            currentSongId: "song-2",
            visitedSongs: ["song-1", "song-2"],
            moves: 1,
        };
        expect(getBackAvailability(moved)).toEqual({
            enabled: true,
            reason: null,
        });
        expect(getDeadEndRecoveryAction(moved)).toBe("back");

        expect(
            getBackAvailability({ ...moved, status: "won" }),
        ).toMatchObject({ enabled: false });
    });
});
