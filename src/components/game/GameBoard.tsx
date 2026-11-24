import {
    useEffect,
    useReducer,
    useRef,
    type Dispatch,
    type Ref,
} from "react";
import { LoaderCircle, RotateCcw, Shuffle } from "lucide-react";
import { Button } from "../ui/Button";
import { getAvailableMoves } from "../../game/gameEngine";
import {
    RACE_DIFFICULTIES,
    isRaceDifficulty,
} from "../../game/raceGenerator";
import { getSong } from "../../game/graph";
import { RecommendationList } from "./RecommendationList";
import { SongCard } from "./SongCard";
import { CustomRacePanel } from "./CustomRacePanel";
import { VictoryPanel } from "./VictoryPanel";
import {
    createInitialCustomRaceState,
    customRaceReducer,
} from "./customRaceState";
import type { RaceMode } from "./customRaceState";
import {
    createInitialGameBoardState,
    fetchLastFmGraphData,
    gameBoardReducer,
    triggerCurrentSongExpansion,
} from "./gameBoardState";
import type {
    GameBoardAction,
    GameDataMode,
} from "./gameBoardState";
import type { RaceDifficulty } from "../../game/raceGenerator";
import {
    getBackAvailability,
    getDeadEndRecoveryAction,
    getRecommendationPresentation,
} from "./gameBoardPresentation";
import { getPlayerFacingErrorMessage } from "./playerFacingError";

function RaceModeSelector({
    mode,
    onChange,
    selectRef,
}: {
    mode: RaceMode;
    onChange: (mode: RaceMode) => void;
    selectRef?: Ref<HTMLSelectElement>;
}) {
    return (
        <label className="flex w-full flex-col gap-1 text-sm font-medium text-foreground sm:w-auto">
            Race mode
            <select
                ref={selectRef}
                value={mode}
                onChange={(event) =>
                    onChange(
                        event.currentTarget.value === "custom"
                            ? "custom"
                            : "random",
                    )
                }
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-40"
            >
                <option value="random">Random</option>
                <option value="custom">Custom</option>
            </select>
        </label>
    );
}

function DataSourceSelector({
    mode,
    dispatch,
    selectRef,
}: {
    mode: GameDataMode;
    dispatch: Dispatch<GameBoardAction>;
    selectRef?: Ref<HTMLSelectElement>;
}) {
    return (
        <label className="flex w-full flex-col gap-1 text-sm font-medium text-foreground sm:w-auto">
            Song source
            <select
                ref={selectRef}
                value={mode}
                onChange={(event) =>
                    dispatch({
                        type: "change-mode",
                        mode: event.currentTarget.value === "lastfm" ? "lastfm" : "demo",
                    })
                }
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-40"
            >
                <option value="demo">Demo</option>
                <option value="lastfm">Last.fm</option>
            </select>
        </label>
    );
}

function DifficultySelector({
    difficulty,
    dispatch,
}: {
    difficulty: RaceDifficulty;
    dispatch: Dispatch<GameBoardAction>;
}) {
    return (
        <label className="flex w-full flex-col gap-1 text-sm font-medium text-foreground sm:w-auto">
            Race difficulty
            <select
                value={difficulty}
                onChange={(event) => {
                    const selected = event.currentTarget.value;
                    if (isRaceDifficulty(selected)) {
                        dispatch({
                            type: "change-difficulty",
                            difficulty: selected,
                        });
                    }
                }}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-48"
            >
                {Object.entries(RACE_DIFFICULTIES).map(
                    ([value, { label, minMoves, maxMoves }]) => (
                        <option key={value} value={value}>
                            {label} ({minMoves}–{maxMoves} moves)
                        </option>
                    ),
                )}
            </select>
        </label>
    );
}

export function GameBoard() {
    const currentSongHeadingRef = useRef<HTMLHeadingElement>(null);
    const wasCustomRacePlaying = useRef(false);
    const raceModeSelectRef = useRef<HTMLSelectElement>(null);
    const dataSourceSelectRef = useRef<HTMLSelectElement>(null);
    const loadingHeadingRef = useRef<HTMLHeadingElement>(null);
    const previousRaceMode = useRef<RaceMode>("random");
    const previousDataMode = useRef<GameDataMode>("demo");
    const previousStatus = useRef("ready");
    const pendingKeyboardMoveFocus = useRef(false);
    const [state, dispatch] = useReducer(
        gameBoardReducer,
        undefined,
        createInitialGameBoardState,
    );
    const [customRace, dispatchCustomRace] = useReducer(
        customRaceReducer,
        undefined,
        createInitialCustomRaceState,
    );

    useEffect(() => {
        if (customRace.playing && !wasCustomRacePlaying.current) {
            currentSongHeadingRef.current?.focus({ preventScroll: true });
        }
        wasCustomRacePlaying.current = customRace.playing;
    }, [customRace.playing]);

    useEffect(() => {
        if (previousRaceMode.current !== customRace.mode) {
            raceModeSelectRef.current?.focus({ preventScroll: true });
        }
        previousRaceMode.current = customRace.mode;
    }, [customRace.mode]);

    useEffect(() => {
        if (previousDataMode.current !== state.mode) {
            dataSourceSelectRef.current?.focus({ preventScroll: true });
        }
        previousDataMode.current = state.mode;
    }, [state.mode]);

    useEffect(() => {
        if (
            (previousStatus.current === "error" ||
                previousStatus.current === "no-race") &&
            state.status === "loading"
        ) {
            loadingHeadingRef.current?.focus({ preventScroll: true });
        }
        previousStatus.current = state.status;
    }, [state.status]);

    function changeRaceMode(mode: RaceMode) {
        if (mode === "random" && state.raceKind === "custom") {
            dispatch({ type: "leave-custom-race" });
        }
        dispatchCustomRace({ type: "set-mode", mode });
    }

    useEffect(() => {
        if (
            customRace.mode !== "random" ||
            state.mode !== "lastfm" ||
            state.status !== "loading"
        ) {
            return;
        }

        const requestId = state.requestId;
        const controller = new AbortController();
        let current = true;

        void fetchLastFmGraphData(fetch, controller.signal).then(
            ({ graph, expandedSongIds }) => {
                if (current) {
                    dispatch({
                        type: "graph-loaded",
                        requestId,
                        graph,
                        expandedSongIds,
                    });
                }
            },
            (error: unknown) => {
                if (current && !controller.signal.aborted) {
                    dispatch({
                        type: "load-failed",
                        requestId,
                        error: getPlayerFacingErrorMessage(
                            error,
                            "Could not load the Last.fm graph. Check your connection and retry.",
                        ),
                    });
                }
            },
        );

        return () => {
            current = false;
            controller.abort();
        };
    }, [customRace.mode, state.mode, state.requestId, state.status]);

    const activeSongId = state.session?.gameState.currentSongId;
    const exploration = state.session?.exploration;
    useEffect(() => {
        if (!pendingKeyboardMoveFocus.current) return;
        pendingKeyboardMoveFocus.current = false;
        currentSongHeadingRef.current?.focus({ preventScroll: true });
    }, [activeSongId]);

    useEffect(() => {
        if (customRace.mode !== "random" && !customRace.playing) return;
        triggerCurrentSongExpansion(state, dispatch);
    }, [
        activeSongId,
        customRace.mode,
        customRace.playing,
        exploration,
        state.expansionStatus,
        state.graph,
        state.mode,
        state.raceVersion,
        state.session,
        state.session?.gameState.status,
        state.status,
    ]);

    if (customRace.mode === "custom" && !customRace.playing) {
        return (
            <main
                data-theme="radio-terminal"
                className="radio-game-shell mx-auto flex min-h-full w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12"
            >
                <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="radio-brand-label">
                            Spotify Races
                        </p>
                        <p className="radio-technical-label mb-1">
                            Music navigation terminal
                        </p>
                        <h1 className="radio-heading text-3xl tracking-tight sm:text-4xl">
                            Build a custom race
                        </h1>
                        <p className="mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
                            Choose the songs you want to race between.
                        </p>
                    </div>
                    <RaceModeSelector
                        mode={customRace.mode}
                        onChange={changeRaceMode}
                        selectRef={raceModeSelectRef}
                    />
                </header>
                <CustomRacePanel
                    state={customRace}
                    dispatch={dispatchCustomRace}
                    onStart={() => {
                        if (!customRace.startSong || !customRace.targetSong) {
                            return;
                        }
                        dispatch({
                            type: "start-custom-race",
                            startSong: customRace.startSong,
                            targetSong: customRace.targetSong,
                        });
                        dispatchCustomRace({ type: "race-started" });
                    }}
                />
            </main>
        );
    }

    if (state.status === "loading") {
        return (
            <main
                data-theme="radio-terminal"
                className="radio-game-shell mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-4 py-12 text-center sm:px-6"
            >
                <p className="radio-brand-label">
                    Spotify Races
                </p>
                <RaceModeSelector
                    mode={customRace.mode}
                    onChange={changeRaceMode}
                    selectRef={raceModeSelectRef}
                />
                <DataSourceSelector
                    mode={state.mode}
                    dispatch={dispatch}
                    selectRef={dataSourceSelectRef}
                />
                <DifficultySelector
                    difficulty={state.difficulty}
                    dispatch={dispatch}
                />
                <h1
                    ref={loadingHeadingRef}
                    tabIndex={-1}
                    className="radio-heading rounded-sm text-3xl tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-4xl"
                >
                    Loading Last.fm graph
                </h1>
                <p
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                    className="mt-3 flex items-center gap-2 text-muted-foreground"
                >
                    <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    Building a song graph from M83 recommendations. This may take a moment.
                </p>
            </main>
        );
    }

    if (state.status === "error") {
        return (
            <main
                data-theme="radio-terminal"
                className="radio-game-shell mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-4 py-12 text-center sm:px-6"
            >
                <p className="radio-brand-label">
                    Spotify Races
                </p>
                <RaceModeSelector
                    mode={customRace.mode}
                    onChange={changeRaceMode}
                    selectRef={raceModeSelectRef}
                />
                <DataSourceSelector
                    mode={state.mode}
                    dispatch={dispatch}
                    selectRef={dataSourceSelectRef}
                />
                <DifficultySelector
                    difficulty={state.difficulty}
                    dispatch={dispatch}
                />
                <h1 className="radio-heading text-3xl tracking-tight sm:text-4xl">
                    Could not load Last.fm songs
                </h1>
                <p role="alert" className="mt-3 max-w-md text-muted-foreground">
                    {state.error}
                </p>
                <Button
                    className="radio-mechanical-button mt-6"
                    onClick={() => dispatch({ type: "retry-load" })}
                >
                    <RotateCcw aria-hidden="true" />
                    Retry
                </Button>
            </main>
        );
    }

    if (state.status === "no-race" || !state.session || !state.graph) {
        return (
            <main
                data-theme="radio-terminal"
                className="radio-game-shell mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-4 py-12 text-center sm:px-6"
            >
                <p className="radio-brand-label">
                    Spotify Races
                </p>
                <RaceModeSelector
                    mode={customRace.mode}
                    onChange={changeRaceMode}
                    selectRef={raceModeSelectRef}
                />
                <DataSourceSelector
                    mode={state.mode}
                    dispatch={dispatch}
                    selectRef={dataSourceSelectRef}
                />
                <DifficultySelector
                    difficulty={state.difficulty}
                    dispatch={dispatch}
                />
                <h1 className="radio-heading text-3xl tracking-tight sm:text-4xl">
                    No race available
                </h1>
                <p role="status" aria-live="polite" className="mt-3 max-w-md text-muted-foreground">
                    This song graph has no reachable pair for{" "}
                    {RACE_DIFFICULTIES[state.difficulty].label} difficulty (
                    {RACE_DIFFICULTIES[state.difficulty].minMoves}–
                    {RACE_DIFFICULTIES[state.difficulty].maxMoves} moves).
                    Choose another difficulty or switch song sources.
                </p>
                {state.mode === "lastfm" && (
                    <Button
                        className="radio-mechanical-button mt-6"
                        onClick={() => dispatch({ type: "retry-load" })}
                    >
                        <RotateCcw aria-hidden="true" />
                        Reload Last.fm graph
                    </Button>
                )}
            </main>
        );
    }

    const { session, mode } = state;
    const graph = session.exploration.graph;
    const { gameState } = session;
    const availableMoves = getAvailableMoves(graph, gameState);
    const startSong = getSong(graph, gameState.startSongId)!;
    const currentSong = getSong(graph, gameState.currentSongId)!;
    const targetSong = getSong(graph, gameState.targetSongId)!;
    const backAvailability = getBackAvailability(gameState);
    const currentSongExpanded = session.exploration.expandedSongIds.has(
        gameState.currentSongId,
    );
    const recommendationPresentation = getRecommendationPresentation({
        expansionStatus: state.expansionStatus,
        isExpanded: currentSongExpanded,
        availableMoveCount: availableMoves.length,
    });
    const completedRoute = gameState.visitedSongs.flatMap((songId, index) => {
        const song = getSong(graph, songId);
        return song
            ? [
                  {
                      song,
                      isStart: index === 0,
                      isDestination:
                          index === gameState.visitedSongs.length - 1 &&
                          songId === gameState.targetSongId,
                  },
              ]
            : [];
    });

    function selectSong(songId: string) {
        const activeElement =
            typeof document === "undefined" ? null : document.activeElement;
        pendingKeyboardMoveFocus.current =
            activeElement instanceof HTMLElement &&
            activeElement.matches(":focus-visible");
        dispatch({ type: "move", songId });
    }

    return (
        <main
            data-theme="radio-terminal"
            className="radio-game-shell mx-auto flex min-h-full w-full max-w-7xl flex-col gap-4 px-3 py-5 sm:gap-5 sm:px-6 sm:py-8"
        >
            <header className="radio-console-header flex flex-col gap-4 pb-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                    <p className="radio-brand-label">Spotify Races</p>
                    <p className="radio-technical-label mb-1">Music navigation terminal</p>
                    <h1 className="radio-heading text-2xl tracking-tight sm:text-3xl">
                        Link the songs
                    </h1>
                    <p className="radio-status-indicator mt-2 px-3 py-1 text-xs font-medium">
                        {state.raceKind === "custom"
                            ? "Custom race · Last.fm songs"
                            : `Random · ${RACE_DIFFICULTIES[state.difficulty].label} · ${mode === "demo" ? "Demo songs" : "Last.fm songs"}`}
                    </p>
                </div>
                <div className="radio-console-settings w-full lg:max-w-3xl">
                    <RaceModeSelector
                        mode={customRace.mode}
                        onChange={changeRaceMode}
                        selectRef={raceModeSelectRef}
                    />
                    {state.raceKind === "random" && (
                        <>
                            <DataSourceSelector
                                mode={mode}
                                dispatch={dispatch}
                                selectRef={dataSourceSelectRef}
                            />
                            <DifficultySelector
                                difficulty={state.difficulty}
                                dispatch={dispatch}
                            />
                        </>
                    )}
                </div>
            </header>

            <nav
                aria-label="Race controls"
                className="radio-command-strip flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
                <div className="grid grid-cols-2 gap-2 sm:flex">
                    <Button
                        variant="outline"
                        className="radio-mechanical-button w-full justify-center sm:w-auto"
                        onClick={() =>
                            dispatch({
                                type: "back",
                                expectedCurrentSongId: gameState.currentSongId,
                            })
                        }
                        disabled={!backAvailability.enabled}
                        aria-label="Back to previous song"
                        title={
                            backAvailability.reason ??
                            "Remove the last move and return to the previous song."
                        }
                    >
                        ← Back
                    </Button>
                    <Button
                        variant="outline"
                        className="radio-mechanical-button w-full justify-center sm:w-auto"
                        onClick={() =>
                            dispatch({
                                type: "restart-race",
                                expectedRaceVersion: state.raceVersion,
                            })
                        }
                        aria-label="Restart current race"
                        title="Return to the starting song and keep recommendations already loaded."
                    >
                        <RotateCcw aria-hidden="true" />
                        Restart
                    </Button>
                    {state.raceKind === "custom" ? (
                        <Button
                            className="radio-mechanical-button radio-primary-action col-span-2 w-full justify-center sm:col-span-1 sm:w-auto"
                            onClick={() => {
                                dispatch({ type: "leave-custom-race" });
                                dispatchCustomRace({ type: "new-custom-race" });
                            }}
                        >
                            <Shuffle aria-hidden="true" />
                            New Custom Race
                        </Button>
                    ) : (
                        <Button
                            className="radio-mechanical-button radio-primary-action col-span-2 w-full justify-center sm:col-span-1 sm:w-auto"
                            onClick={() =>
                                dispatch({
                                    type: "new-race",
                                    expectedRaceVersion: state.raceVersion,
                                })
                            }
                        >
                            <Shuffle aria-hidden="true" />
                            New Race
                        </Button>
                    )}
                </div>
                <p className="text-xs text-muted-foreground sm:max-w-sm sm:text-right" aria-live="polite">
                    {backAvailability.reason ??
                        "Back removes the last move. Restart keeps recommendations already loaded."}
                </p>
            </nav>

            {state.notice && (
                <p role="status" aria-live="polite" className="mb-5 text-sm text-muted-foreground">
                    {state.notice}
                </p>
            )}

            <div
                className={`radio-game-layout grid min-w-0 gap-4 sm:gap-5 ${
                    gameState.status === "won"
                        ? "grid-cols-1"
                        : "md:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]"
                }`}
            >
                <section aria-label="Song receiver" className="radio-terminal-panel min-w-0 p-3 sm:p-5 lg:p-6">
                    <div className="mb-4">
                        <div>
                            <h2
                                ref={currentSongHeadingRef}
                                tabIndex={-1}
                                className="rounded-sm text-lg font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                {gameState.status === "won"
                                    ? "Race complete"
                                    : "Current song"}
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {gameState.status === "won"
                                    ? "You reached the selected destination."
                                    : "Choose one of its recommendations to make your next move."}
                            </p>
                        </div>
                    </div>

                    <div
                        aria-label={`Current song: ${currentSong.title} by ${currentSong.artist}`}
                        className="radio-inset-display mb-5 p-3 sm:p-5"
                    >
                        <p className="radio-technical-label mb-3">
                            {gameState.status === "won"
                                ? "Destination reached"
                                : "Current song"}
                        </p>
                        <SongCard
                            song={currentSong}
                            className="[&>div:first-child]:h-16 [&>div:first-child]:w-16 [&_p:first-child]:text-lg sm:[&>div:first-child]:h-20 sm:[&>div:first-child]:w-20 sm:[&_p:first-child]:text-xl"
                        />
                    </div>
                    {gameState.status !== "won" && (
                        <p className="sr-only" aria-live="polite" aria-atomic="true">
                            Current song: {currentSong.title} by {currentSong.artist}.
                        </p>
                    )}

                    {gameState.status === "won" ? (
                        <VictoryPanel
                            start={startSong}
                            destination={targetSong}
                            moves={gameState.moves}
                            shortestPathMoves={session.race.optimalMoves}
                            raceKind={state.raceKind}
                            route={completedRoute}
                        />
                    ) : (
                        <>
                            <h3 className="radio-section-divider mb-3 text-sm font-semibold">
                                Recommended next songs
                            </h3>
                            {recommendationPresentation.loading && (
                                <p
                                    role="status"
                                    aria-live="polite"
                                    aria-busy="true"
                                    className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"
                                >
                                    <LoaderCircle
                                        className="h-4 w-4 animate-spin motion-reduce:animate-none"
                                        aria-hidden="true"
                                    />
                                    {recommendationPresentation.hasRecommendations
                                        ? "Checking for more recommendations…"
                                        : "Loading recommendations for this song…"}
                                </p>
                            )}
                            {recommendationPresentation.error && (
                                <div role="alert" className="radio-terminal-panel mb-3 border-destructive/50 p-4">
                                    <p className="text-sm text-muted-foreground">
                                        {state.expansionError}
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Your current race is saved. You can retry without losing your route.
                                    </p>
                                    <Button
                                        variant="outline"
                                        className="radio-mechanical-button mt-3"
                                        onClick={() => {
                                            currentSongHeadingRef.current?.focus({
                                                preventScroll: true,
                                            });
                                            dispatch({ type: "retry-expansion" });
                                        }}
                                    >
                                        <RotateCcw aria-hidden="true" />
                                        Retry recommendations
                                    </Button>
                                </div>
                            )}
                            {recommendationPresentation.deadEnd && (
                                <div
                                    role="status"
                                    aria-live="polite"
                                    className="radio-terminal-panel p-4"
                                >
                                    <p className="radio-technical-label">
                                        No unvisited recommendations
                                    </p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        Recommendations for this song loaded successfully, but
                                        none can continue your current route.
                                    </p>
                                    <Button
                                        variant="outline"
                                        className="radio-mechanical-button mt-3"
                                        onClick={() => {
                                            if (
                                                getDeadEndRecoveryAction(gameState) ===
                                                "back"
                                            ) {
                                                dispatch({
                                                    type: "back",
                                                    expectedCurrentSongId:
                                                        gameState.currentSongId,
                                                });
                                            } else {
                                                dispatch({
                                                    type: "restart-race",
                                                    expectedRaceVersion:
                                                        state.raceVersion,
                                                });
                                            }
                                        }}
                                    >
                                        {getDeadEndRecoveryAction(gameState) === "back"
                                            ? "Back to previous song"
                                            : "Restart race"}
                                    </Button>
                                </div>
                            )}
                            {recommendationPresentation.hasRecommendations && (
                                <RecommendationList
                                    graph={graph}
                                    songIds={availableMoves}
                                    onSelect={selectSong}
                                />
                            )}
                        </>
                    )}
                </section>

                {gameState.status !== "won" && (
                    <aside
                        aria-label="Navigation panel"
                        className="radio-navigation-panel flex min-w-0 flex-col gap-4 self-start"
                    >
                    <section
                        aria-label={`Destination: ${targetSong.title} by ${targetSong.artist}`}
                        className="radio-destination-panel min-w-0 p-3 sm:p-4"
                    >
                        <p className="radio-technical-label mb-2">Race destination</p>
                        <SongCard
                            song={targetSong}
                            className="[&>div:first-child]:h-12 [&>div:first-child]:w-12 [&_p:first-child]:font-bold"
                        />
                    </section>

                    <section className="radio-terminal-panel min-w-0 p-3 sm:p-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h2 className="radio-heading text-lg">Your route</h2>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Start to current song · {gameState.visitedSongs.length}{" "}
                                    {gameState.visitedSongs.length === 1 ? "song" : "songs"}
                                </p>
                            </div>
                            <div
                                className="radio-move-counter shrink-0"
                                aria-label={`${gameState.moves} moves`}
                            >
                                <span className="radio-move-count">{gameState.moves}</span>
                                {" "}
                                <span className="radio-move-unit">
                                    {gameState.moves === 1 ? "move" : "moves"}
                                </span>
                            </div>
                        </div>
                        <ol
                            aria-label="Visited songs in order"
                            className="radio-route-log"
                        >
                            {gameState.visitedSongs.map((songId, index) => {
                                const song = getSong(graph, songId);
                                if (!song) return null;

                                const isCurrent =
                                    index === gameState.visitedSongs.length - 1 &&
                                    songId === gameState.currentSongId;
                                const isStart = index === 0;

                                return (
                                    <li
                                        key={`${songId}-${index}`}
                                        aria-current={isCurrent ? "step" : undefined}
                                        className={`radio-route-entry${isCurrent ? " is-current" : ""}`}
                                    >
                                        <span className="radio-route-index" aria-hidden="true">
                                            {String(index + 1).padStart(2, "0")}
                                        </span>
                                        <SongCard
                                            song={song}
                                            className="min-w-0 flex-1 [&>div:first-child]:h-9 [&>div:first-child]:w-9 [&_svg]:h-4 [&_svg]:w-4 [&_p:first-child]:text-sm [&_p:last-child]:text-xs"
                                        />
                                        <span className="radio-route-role">
                                            {isCurrent
                                                ? isStart
                                                    ? "Start · Current"
                                                    : "Current"
                                                : isStart
                                                  ? "Start"
                                                  : ""}
                                        </span>
                                    </li>
                                );
                            })}
                        </ol>
                    </section>
                    </aside>
                )}
            </div>
        </main>
    );
}
