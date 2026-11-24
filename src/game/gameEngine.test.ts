import { describe, expect, it } from "vitest";
import {
    backtrack,
    createGame,
    getAvailableMoves,
    makeMove,
} from "./gameEngine";
import { mockGraph } from "./graph";
import type { GameState } from "./gameTypes";

describe("createGame", () => {
    it("initializes a game with the starting song visited and no moves", () => {
        expect(createGame(mockGraph, "song-1", "song-7")).toEqual({
            startSongId: "song-1",
            targetSongId: "song-7",
            currentSongId: "song-1",
            visitedSongs: ["song-1"],
            moves: 0,
            status: "playing",
        });
    });

    it("throws when the starting song does not exist", () => {
        expect(() => createGame(mockGraph, "missing-song", "song-7")).toThrow(
            'Starting song "missing-song" does not exist.',
        );
    });

    it("throws when the target song does not exist", () => {
        expect(() => createGame(mockGraph, "song-1", "missing-song")).toThrow(
            'Target song "missing-song" does not exist.',
        );
    });

    it("throws when start and target songs are the same", () => {
        expect(() => createGame(mockGraph, "song-1", "song-1")).toThrow(
            "Starting and target songs must be different.",
        );
    });
});

describe("getAvailableMoves", () => {
    it("returns direct recommendations that have not been visited", () => {
        const game = createGame(mockGraph, "song-1", "song-7");
        const afterFirstMove = makeMove(mockGraph, game, "song-2");

        expect(afterFirstMove).not.toBeNull();
        expect(getAvailableMoves(mockGraph, afterFirstMove!)).toEqual([
            "song-4",
            "song-5",
        ]);
    });

    it("returns no moves for a dead end", () => {
        const game: GameState = {
            ...createGame(mockGraph, "song-1", "song-7"),
            currentSongId: "song-6",
            visitedSongs: ["song-1", "song-6"],
        };

        expect(getAvailableMoves(mockGraph, game)).toEqual([]);
    });

    it("excludes neighbors already visited", () => {
        const game: GameState = {
            ...createGame(mockGraph, "song-1", "song-7"),
            currentSongId: "song-2",
            visitedSongs: ["song-1", "song-2", "song-4"],
        };

        expect(getAvailableMoves(mockGraph, game)).toEqual(["song-5"]);
    });
});

describe("makeMove", () => {
    it("advances to a directly connected, unvisited song", () => {
        const game = createGame(mockGraph, "song-1", "song-7");
        const nextGame = makeMove(mockGraph, game, "song-2");

        expect(nextGame).toEqual({
            ...game,
            currentSongId: "song-2",
            visitedSongs: ["song-1", "song-2"],
            moves: 1,
            status: "playing",
        });

    });

    it("does not mutate the original state when a move is invalid", () => {
        const game = createGame(mockGraph, "song-1", "song-7");
        const originalGame = {
            ...game,
            visitedSongs: [...game.visitedSongs],
        };

        expect(makeMove(mockGraph, game, "song-4")).toBeNull();
        expect(game).toEqual(originalGame);
    });

    it("rejects revisiting a previously visited song", () => {
        const game: GameState = {
            ...createGame(mockGraph, "song-1", "song-7"),
            currentSongId: "song-2",
            visitedSongs: ["song-1", "song-2"],
            moves: 1,
        };

        expect(makeMove(mockGraph, game, "song-1")).toBeNull();
        expect(game.currentSongId).toBe("song-2");
        expect(game.visitedSongs).toEqual(["song-1", "song-2"]);
        expect(game.moves).toBe(1);
    });

    it("sets the status to won when the target is reached", () => {
        const game = createGame(mockGraph, "song-1", "song-7");
        const nextGame = makeMove(mockGraph, game, "song-2");
        const winningGame = makeMove(mockGraph, nextGame!, "song-4");
        const completedGame = makeMove(mockGraph, winningGame!, "song-7");

        expect(completedGame).toEqual({
            ...game,
            currentSongId: "song-7",
            visitedSongs: ["song-1", "song-2", "song-4", "song-7"],
            moves: 3,
            status: "won",
        });
    });

    it("prevents moves after the game is won", () => {
        const game = createGame(mockGraph, "song-1", "song-7");
        const firstMove = makeMove(mockGraph, game, "song-2");
        const secondMove = makeMove(mockGraph, firstMove!, "song-4");
        const wonGame = makeMove(mockGraph, secondMove!, "song-7");
        const originalWonGame = {
            ...wonGame!,
            visitedSongs: [...wonGame!.visitedSongs],
        };

        expect(makeMove(mockGraph, wonGame!, "song-9")).toBeNull();
        expect(wonGame).toEqual(originalWonGame);
    });

    it("rejects moves to unknown songs", () => {
        const game = createGame(mockGraph, "song-1", "song-7");

        expect(makeMove(mockGraph, game, "missing-song")).toBeNull();
        expect(game.moves).toBe(0);
    });
});

describe("backtrack", () => {
    it("returns to the previous visited song and decrements moves", () => {
        const game = createGame(mockGraph, "song-1", "song-7");
        const oneMove = makeMove(mockGraph, game, "song-2")!;
        const previous = backtrack(oneMove);

        expect(previous).toEqual({
            ...game,
            currentSongId: "song-1",
            visitedSongs: ["song-1"],
            moves: 0,
            status: "playing",
        });
        expect(oneMove.currentSongId).toBe("song-2");
    });

    it("backs up one step after multiple moves without requiring a reverse edge", () => {
        const game = createGame(mockGraph, "song-1", "song-7");
        const moved = makeMove(
            mockGraph,
            makeMove(mockGraph, game, "song-2")!,
            "song-4",
        )!;

        expect(backtrack(moved)).toMatchObject({
            currentSongId: "song-2",
            visitedSongs: ["song-1", "song-2"],
            moves: 1,
        });
        expect(mockGraph.edges.get("song-4")).not.toContain("song-2");
    });

    it("does not backtrack at the start or after a win", () => {
        const initial = createGame(mockGraph, "song-1", "song-7");
        const atStart = backtrack(initial);
        const won = makeMove(
            mockGraph,
            makeMove(
                mockGraph,
                makeMove(mockGraph, initial, "song-2")!,
                "song-4",
            )!,
            "song-7",
        )!;

        expect(atStart).toBeNull();
        expect(backtrack(won)).toBeNull();
    });
});
