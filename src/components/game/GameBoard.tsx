import { useState } from "react";
import { RotateCcw, Shuffle, Trophy } from "lucide-react";
import { Button } from "../ui/Button";
import {
    createGame,
    getAvailableMoves,
    makeMove,
} from "../../game/gameEngine";
import type { GameState } from "../../game/gameTypes";
import { findShortestPath } from "../../game/pathfinding";
import { getSong, mockGraph } from "../../game/graph";
import { generateRace } from "../../game/raceGenerator";
import type { GeneratedRace } from "../../game/raceGenerator";
import { RecommendationList } from "./RecommendationList";
import { SongCard } from "./SongCard";

interface RaceSession {
    race: GeneratedRace;
    gameState: GameState;
}

function createRaceSession(): RaceSession | null {
    const race = generateRace(mockGraph);
    if (!race) {
        return null;
    }

    return {
        race,
        gameState: createGame(mockGraph, race.startSongId, race.targetSongId),
    };
}

function formatPath(songIds: string[]): string {
    return songIds
        .map((songId) => getSong(mockGraph, songId)?.title ?? songId)
        .join(" → ");
}

export function GameBoard() {
    const [session, setSession] = useState<RaceSession | null>(createRaceSession);
    const gameState = session?.gameState;

    function startNewRace() {
        setSession(createRaceSession());
    }

    function restartRace() {
        setSession((currentSession) =>
            currentSession
                ? {
                      ...currentSession,
                      gameState: createGame(
                          mockGraph,
                          currentSession.race.startSongId,
                          currentSession.race.targetSongId,
                      ),
                  }
                : null,
        );
    }

    if (!session || !gameState) {
        return (
            <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-4 py-12 text-center sm:px-6">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">
                    Spotify Races
                </p>
                <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                    No race available
                </h1>
                <p role="status" aria-live="polite" className="mt-3 max-w-md text-muted-foreground">
                    The song graph has no reachable pair within the supported race
                    length. Try again after the graph has more connections.
                </p>
                <Button onClick={startNewRace} className="mt-6">
                    <Shuffle aria-hidden="true" />
                    Try New Race
                </Button>
            </main>
        );
    }

    const availableMoves = getAvailableMoves(mockGraph, gameState);
    const startSong = getSong(mockGraph, gameState.startSongId)!;
    const currentSong = getSong(mockGraph, gameState.currentSongId)!;
    const targetSong = getSong(mockGraph, gameState.targetSongId)!;
    const optimalPath =
        gameState.status === "won"
            ? findShortestPath(mockGraph, gameState.startSongId, gameState.targetSongId)
            : null;

    function selectSong(songId: string) {
        setSession((currentSession) => {
            if (!currentSession) {
                return currentSession;
            }

            const nextState = makeMove(
                mockGraph,
                currentSession.gameState,
                songId,
            );
            return nextState
                ? { ...currentSession, gameState: nextState }
                : currentSession;
        });
    }

    return (
        <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
            <header className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">
                        Spotify Races
                    </p>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                        Link the songs
                    </h1>
                    <p className="mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
                        Race from the starting track to the destination using only
                        song recommendations. Can you find the shortest route?
                    </p>
                </div>
                <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
                    <Button variant="outline" onClick={restartRace}>
                        <RotateCcw aria-hidden="true" />
                        Restart
                    </Button>
                    <Button onClick={startNewRace}>
                        <Shuffle aria-hidden="true" />
                        New Race
                    </Button>
                </div>
            </header>

            <section
                aria-label="Race endpoints"
                className="mb-6 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:p-5"
            >
                <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Start
                    </p>
                    <SongCard song={startSong} />
                </div>
                <span className="hidden text-muted-foreground sm:block" aria-hidden="true">
                    →
                </span>
                <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Destination
                    </p>
                    <SongCard song={targetSong} />
                </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
                <section className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-6">
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-semibold text-foreground">Current song</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Choose one of its recommendations to make your next move.
                            </p>
                        </div>
                        <div
                            className="rounded-full border border-border bg-background px-3 py-1 text-sm font-medium text-foreground"
                            aria-label={`${gameState.moves} moves`}
                        >
                            {gameState.moves} {gameState.moves === 1 ? "move" : "moves"}
                        </div>
                    </div>

                    <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
                        <SongCard song={currentSong} className="[&_p:first-child]:text-base" />
                    </div>

                    {gameState.status === "won" ? (
                        <div
                            role="status"
                            aria-live="polite"
                            className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4"
                        >
                            <div className="flex items-center gap-2 font-semibold text-emerald-300">
                                <Trophy className="h-5 w-5" aria-hidden="true" />
                                You made it to the destination!
                            </div>
                            <p className="mt-2 text-sm text-foreground">
                                Your route: {formatPath(gameState.visitedSongs)}
                            </p>
                            {optimalPath ? (
                                <>
                                    <p className="mt-2 text-sm text-muted-foreground">
                                        Shortest route ({optimalPath.length - 1}{" "}
                                        {optimalPath.length - 1 === 1 ? "move" : "moves"}):{" "}
                                        {formatPath(optimalPath)}
                                    </p>
                                    <p className="mt-2 text-sm font-medium text-emerald-300">
                                        {gameState.moves === optimalPath.length - 1
                                            ? "You found an optimal route!"
                                            : `You used ${gameState.moves - (optimalPath.length - 1)} extra ${
                                                  gameState.moves - (optimalPath.length - 1) === 1
                                                      ? "move"
                                                      : "moves"
                                              }.`}
                                    </p>
                                </>
                            ) : (
                                <p className="mt-2 text-sm text-muted-foreground">
                                    No route is available for comparison.
                                </p>
                            )}
                        </div>
                    ) : (
                        <>
                            <h3 className="mb-3 text-sm font-semibold text-foreground">
                                Recommended next songs
                            </h3>
                            {availableMoves.length === 0 ? (
                                <div
                                    role="status"
                                    aria-live="polite"
                                    className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4"
                                >
                                    <p className="font-semibold text-amber-200">Dead end</p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        There are no unvisited recommendations left. Restart
                                        this race or generate a new race.
                                    </p>
                                </div>
                            ) : (
                                <RecommendationList
                                    graph={mockGraph}
                                    songIds={availableMoves}
                                    onSelect={selectSong}
                                />
                            )}
                        </>
                    )}
                </section>

                <aside className="rounded-2xl border border-border bg-card p-4 sm:p-6">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-semibold text-foreground">Your route</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {gameState.visitedSongs.length}{" "}
                                {gameState.visitedSongs.length === 1 ? "song" : "songs"} visited
                            </p>
                        </div>
                        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
                            {gameState.moves} moves
                        </span>
                    </div>
                    <ol
                        aria-label="Visited songs in order"
                        className="space-y-3"
                    >
                        {gameState.visitedSongs.map((songId, index) => {
                            const song = getSong(mockGraph, songId);
                            if (!song) return null;

                            return (
                                <li key={`${songId}-${index}`} className="flex items-center gap-3">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                                        {index + 1}
                                    </span>
                                    <SongCard
                                        song={song}
                                        className="min-w-0 [&>div:first-child]:h-10 [&>div:first-child]:w-10 [&_svg]:h-4 [&_svg]:w-4 [&_p:first-child]:text-sm [&_p:last-child]:text-xs"
                                    />
                                </li>
                            );
                        })}
                    </ol>
                </aside>
            </div>
        </main>
    );
}
