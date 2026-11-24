import { Trophy } from "lucide-react";
import type { Song } from "../../game/types";
import { AlbumArtwork } from "./AlbumArtwork";

export interface VictoryRouteEntry {
    song: Song;
    isStart: boolean;
    isDestination: boolean;
}

export function VictoryPanel({
    start,
    destination,
    moves,
    shortestPathMoves,
    raceKind,
    route,
}: {
    start: Song;
    destination: Song;
    moves: number;
    shortestPathMoves: number | null;
    raceKind: "random" | "custom";
    route: VictoryRouteEntry[];
}) {
    const benchmarkDifference =
        shortestPathMoves === null ? null : moves - shortestPathMoves;

    return (
        <section
            className="radio-victory-panel radio-inset-display p-3 sm:p-5"
            role="region"
            aria-labelledby="victory-heading"
        >
            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                Signal Acquired. Destination reached: {destination.title} by{" "}
                {destination.artist}. Completed in {moves}{" "}
                {moves === 1 ? "move" : "moves"}.
            </p>
            <header className="radio-victory-header flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center">
                <span className="radio-victory-mark" aria-hidden="true">
                    <Trophy className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                    <p className="radio-technical-label mb-1">Transmission complete</p>
                    <h2 id="victory-heading" className="radio-heading text-2xl sm:text-3xl">
                        Signal Acquired
                    </h2>
                    <p className="mt-1 text-sm font-medium text-foreground">
                        Destination reached: {destination.title} by {destination.artist}.
                    </p>
                </div>
            </header>

            <dl className="radio-victory-stats mt-4 grid gap-2 sm:grid-cols-2">
                <div className="radio-victory-stat">
                    <dt className="radio-technical-label">Final active-route moves</dt>
                    <dd>
                        <span className="radio-stat-number">{moves}</span>
                        <span>{moves === 1 ? "move" : "moves"}</span>
                    </dd>
                </div>
                <div className="radio-victory-stat">
                    <dt className="radio-technical-label">
                        {raceKind === "custom"
                            ? "Shortest-path benchmark"
                            : "Original race-graph benchmark"}
                    </dt>
                    {shortestPathMoves === null ? (
                        <dd className="radio-benchmark-note">
                            Unavailable for custom races
                        </dd>
                    ) : (
                        <>
                            <dd>
                                <span className="radio-stat-number">{shortestPathMoves}</span>
                                <span>{shortestPathMoves === 1 ? "move" : "moves"}</span>
                            </dd>
                            <dd className="radio-benchmark-details">
                                <p className="text-xs text-muted-foreground">
                                    Frozen from the original random-race graph; it is not a
                                    benchmark of recommendations discovered later.
                                </p>
                                <p className="mt-2 text-sm font-medium text-foreground">
                                    {benchmarkDifference === 0
                                        ? "Matched the original race-graph benchmark."
                                        : benchmarkDifference !== null &&
                                            benchmarkDifference > 0
                                          ? `${benchmarkDifference} ${
                                                benchmarkDifference === 1 ? "move" : "moves"
                                            } above the original benchmark.`
                                          : `${Math.abs(benchmarkDifference ?? 0)} ${
                                                Math.abs(benchmarkDifference ?? 0) === 1
                                                    ? "move"
                                                    : "moves"
                                            } below the original benchmark.`}
                                </p>
                            </dd>
                        </>
                    )}
                </div>
            </dl>

            <div className="mt-5">
                <h3 className="radio-section-divider mb-3 text-sm font-semibold">
                    Completed transmission log
                </h3>
                <ol
                    aria-label="Completed route in order"
                    className="radio-victory-route"
                >
                    {route.map(({ song, isStart, isDestination }, index) => (
                        <li
                            className={`radio-victory-route-entry${
                                isStart ? " is-start" : ""
                            }${isDestination ? " is-destination" : ""}`}
                            key={`${song.id}-${index}`}
                        >
                            <span className="radio-victory-route-index" aria-hidden="true">
                                {String(index + 1).padStart(2, "0")}
                            </span>
                            <AlbumArtwork
                                albumArt={song.albumArt}
                                className="h-10 w-10 shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                                <p className="break-words font-medium text-foreground [overflow-wrap:anywhere]">
                                    {song.title}
                                </p>
                                <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
                                    {song.artist}
                                </p>
                            </div>
                            <span className="radio-victory-endpoint-label">
                                {isStart && isDestination
                                    ? "Start · Destination"
                                    : isStart
                                      ? "Start"
                                      : isDestination
                                        ? "Destination"
                                        : "Route"}
                            </span>
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}
