import {
    backtrack,
    createGame,
    makeMove,
} from "../../game/gameEngine";
import type { GameState } from "../../game/gameTypes";
import {
    beginExplorationRace,
    initializeExplorationGraph,
    markSongExpanded,
    mergeRecommendations,
    songRequiresExpansion,
} from "../../game/explorationGraph";
import type { ExplorationGraphState } from "../../game/explorationGraph";
import { deserializeGraph } from "../../game/graphSerialization";
import { mockGraph } from "../../game/graph";
import { isCanonicalLastFmSongId } from "../../game/songIds";
import {
    DEFAULT_RACE_DIFFICULTY,
    generateRace,
} from "../../game/raceGenerator";
import type {
    GeneratedRace,
    RaceDifficulty,
} from "../../game/raceGenerator";
import type { Song, SongGraph } from "../../game/types";
import {
    getPlayerFacingErrorMessage,
    getMusicServiceErrorMessage,
    PlayerFacingError,
} from "./playerFacingError";

export type GameDataMode = "demo" | "lastfm";
export type GameLoadStatus = "ready" | "loading" | "error" | "no-race";
export type ExpansionStatus = "idle" | "loading" | "error";

export interface RaceSession {
    race: Omit<GeneratedRace, "optimalMoves"> & { optimalMoves: number | null };
    gameState: GameState;
    exploration: ExplorationGraphState;
}

export interface RandomGameSnapshot {
    mode: GameDataMode;
    difficulty: RaceDifficulty;
    status: GameLoadStatus;
    graph: SongGraph | null;
    expandedSongIds: string[];
    session: RaceSession | null;
    error: string | null;
    notice: string | null;
}

export interface GameBoardState {
    mode: GameDataMode;
    raceKind: "random" | "custom";
    pausedRandomState: RandomGameSnapshot | null;
    difficulty: RaceDifficulty;
    status: GameLoadStatus;
    graph: SongGraph | null;
    expandedSongIds: string[];
    session: RaceSession | null;
    error: string | null;
    notice: string | null;
    expansionStatus: ExpansionStatus;
    expansionSongId: string | null;
    expansionError: string | null;
    raceVersion: number;
    requestId: number;
}

export type GameBoardAction =
    | { type: "change-mode"; mode: GameDataMode }
    | { type: "change-difficulty"; difficulty: RaceDifficulty; random?: () => number }
    | { type: "retry-load" }
    | {
          type: "graph-loaded";
          requestId: number;
          graph: SongGraph;
          expandedSongIds?: string[];
      }
    | { type: "load-failed"; requestId: number; error: string }
    | { type: "restart-race"; expectedRaceVersion?: number }
    | {
          type: "new-race";
          random?: () => number;
          expectedRaceVersion?: number;
      }
    | { type: "start-custom-race"; startSong: Song; targetSong: Song }
    | { type: "leave-custom-race" }
    | { type: "move"; songId: string }
    | { type: "back"; expectedCurrentSongId?: string }
    | { type: "expansion-started"; raceVersion: number; songId: string }
    | {
          type: "expansion-succeeded";
          raceVersion: number;
          songId: string;
          songs: Song[];
      }
    | {
          type: "expansion-failed";
          raceVersion: number;
          songId: string;
          error: string;
      }
    | { type: "retry-expansion" };

export const LASTFM_SEED_SONG_ID = "lastfm:M83:Midnight City";

export interface LoadedLastFmGraph {
    graph: SongGraph;
    expandedSongIds: string[];
}

function isSong(value: unknown): value is Song {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const song = value as Record<string, unknown>;
    return (
        typeof song.id === "string" &&
        isCanonicalLastFmSongId(song.id) &&
        typeof song.title === "string" &&
        song.title.trim().length > 0 &&
        typeof song.artist === "string" &&
        song.artist.trim().length > 0 &&
        typeof song.albumArt === "string"
    );
}

async function responseError(response: Response, prefix: string): Promise<Error> {
    const detail = await getMusicServiceErrorMessage(
        response,
        "Last.fm is temporarily unavailable.",
    );
    return new PlayerFacingError(`${prefix}: ${detail}`);
}

export async function fetchLastFmGraphData(
    fetcher: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<LoadedLastFmGraph> {
    const query = new URLSearchParams();
    query.set("seedSongId", LASTFM_SEED_SONG_ID);

    const response = await fetcher.call(
        globalThis,
        `/api/music/graph?${query.toString()}`,
        { signal },
    );
    if (!response.ok) {
        throw await responseError(response, "Could not load Last.fm graph");
    }

    const serialized: unknown = await response.json();
    const graph = deserializeGraph(serialized);
    if ([...graph.nodes.values()].some((song) => !isSong(song))) {
        throw new PlayerFacingError(
            "Last.fm graph returned invalid song data. Please retry.",
        );
    }
    if (
        typeof serialized !== "object" ||
        serialized === null ||
        Array.isArray(serialized)
    ) {
        throw new TypeError("Last.fm graph response must be an object.");
    }
    const metadata = serialized as Record<string, unknown>;
    const rawExpandedSongIds = metadata.expandedSongIds;
    if (
        rawExpandedSongIds !== undefined &&
        (!Array.isArray(rawExpandedSongIds) ||
            !rawExpandedSongIds.every(
                (songId) =>
                    typeof songId === "string" && graph.nodes.has(songId),
            ) ||
            new Set(rawExpandedSongIds).size !== rawExpandedSongIds.length)
    ) {
        throw new PlayerFacingError(
            "Last.fm graph expansion metadata is invalid. Please retry.",
        );
    }

    return {
        graph,
        expandedSongIds: rawExpandedSongIds ?? [],
    };
}

/** Backward-compatible graph-only loader for existing callers. */
export async function fetchLastFmGraph(
    fetcher: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<SongGraph> {
    return (await fetchLastFmGraphData(fetcher, signal)).graph;
}

const similarSongRequests = new WeakMap<
    SongGraph,
    Map<string, Promise<Song[]>>
>();
const SIMILAR_REQUEST_TIMEOUT_MS = 30_000;

export function fetchLastFmSimilarSongs(
    graphIdentity: SongGraph,
    songId: string,
    fetcher: typeof fetch = fetch,
): Promise<Song[]> {
    let requests = similarSongRequests.get(graphIdentity);
    if (!requests) {
        requests = new Map();
        similarSongRequests.set(graphIdentity, requests);
    }

    const existing = requests.get(songId);
    if (existing) return existing;

    const query = new URLSearchParams({ songId });
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(),
        SIMILAR_REQUEST_TIMEOUT_MS,
    );
    const request = (async () => {
        try {
            const response = await fetcher.call(
                globalThis,
                `/api/music/similar?${query.toString()}`,
                { signal: controller.signal },
            );
            if (!response.ok) {
                throw await responseError(
                    response,
                    "Could not load recommendations",
                );
            }

            const payload: unknown = await response.json();
            if (
                typeof payload !== "object" ||
                payload === null ||
                Array.isArray(payload) ||
                !("songs" in payload) ||
                !Array.isArray(payload.songs) ||
                !payload.songs.every(isSong)
            ) {
                throw new TypeError(
                    "Similar-song response must contain a songs array.",
                );
            }

            return payload.songs.map((song) => ({ ...song }));
        } catch (error) {
            if (controller.signal.aborted) {
                throw new PlayerFacingError(
                    "Recommendation request timed out. Please retry.",
                );
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    })();

    requests.set(songId, request);
    void request.finally(() => {
        if (requests?.get(songId) === request) {
            requests.delete(songId);
        }
    }).catch(() => {
        // The original request promise is observed by the caller.
    });
    return request;
}

export function triggerCurrentSongExpansion(
    state: GameBoardState,
    dispatch: (action: GameBoardAction) => void,
    fetcher: typeof fetch = fetch,
): boolean {
    const session = state.session;
    const graph = state.graph;
    const songId = session?.gameState.currentSongId;
    if (
        (state.mode !== "lastfm" && state.raceKind !== "custom") ||
        state.status !== "ready" ||
        !graph ||
        !session ||
        session.gameState.status !== "playing" ||
        !songId ||
        state.expansionStatus !== "idle" ||
        !songRequiresExpansion(session.exploration, songId)
    ) {
        return false;
    }

    const raceVersion = state.raceVersion;
    dispatch({ type: "expansion-started", raceVersion, songId });
    void fetchLastFmSimilarSongs(graph, songId, fetcher).then(
        (songs) => {
            dispatch({
                type: "expansion-succeeded",
                raceVersion,
                songId,
                songs,
            });
        },
        (error: unknown) => {
            dispatch({
                type: "expansion-failed",
                raceVersion,
                songId,
                error: getPlayerFacingErrorMessage(
                    error,
                    "Could not load recommendations. Your race is saved; retry when ready.",
                ),
            });
        },
    );
    return true;
}

export function createRaceSession(
    graph: SongGraph,
    options: {
        difficulty?: RaceDifficulty;
        random?: () => number;
        excludeRace?: Pick<GeneratedRace, "startSongId" | "targetSongId">;
        previousExploration?: ExplorationGraphState;
        expandedSongIds?: Iterable<string>;
    } = {},
): RaceSession | null {
    const race = generateRace(graph, options);
    if (!race) {
        return null;
    }

    const exploration = options.previousExploration
        ? beginExplorationRace(
              options.previousExploration,
              race.startSongId,
              race.targetSongId,
          )
        : initializeExplorationGraph(
              graph,
              race.startSongId,
              race.targetSongId,
              options.expandedSongIds,
          );

    return {
        race,
        gameState: createGame(graph, race.startSongId, race.targetSongId),
        exploration,
    };
}

function stateForGraph(
    mode: GameDataMode,
    graph: SongGraph,
    requestId: number,
    raceVersion: number,
    difficulty: RaceDifficulty,
    expandedSongIds: string[],
    random?: () => number,
    previousExploration?: ExplorationGraphState,
): GameBoardState {
    const session = createRaceSession(graph, {
        difficulty,
        random,
        expandedSongIds,
        previousExploration,
    });
    return {
        mode,
        raceKind: "random",
        pausedRandomState: null,
        difficulty,
        status: session ? "ready" : "no-race",
        graph,
        expandedSongIds: [...expandedSongIds],
        session,
        error: null,
        notice: null,
        expansionStatus: "idle",
        expansionSongId: null,
        expansionError: null,
        raceVersion,
        requestId,
    };
}

export function createInitialGameBoardState(): GameBoardState {
    return stateForGraph(
        "demo",
        mockGraph,
        0,
        0,
        DEFAULT_RACE_DIFFICULTY,
        [...mockGraph.nodes.keys()],
    );
}

function activeSongId(state: GameBoardState): string | null {
    return state.session?.gameState.currentSongId ?? null;
}

export function gameBoardReducer(
    state: GameBoardState,
    action: GameBoardAction,
): GameBoardState {
    switch (action.type) {
        case "change-mode": {
            if (action.mode === state.mode) return state;
            const requestId = state.requestId + 1;
            const raceVersion = state.raceVersion + 1;
            if (action.mode === "demo") {
                return stateForGraph(
                    "demo",
                    mockGraph,
                    requestId,
                    raceVersion,
                    state.difficulty,
                    [...mockGraph.nodes.keys()],
                );
            }
            return {
                mode: "lastfm",
                raceKind: "random",
                pausedRandomState: null,
                difficulty: state.difficulty,
                status: "loading",
                graph: null,
                expandedSongIds: [],
                session: null,
                error: null,
                notice: null,
                expansionStatus: "idle",
                expansionSongId: null,
                expansionError: null,
                raceVersion,
                requestId,
            };
        }
        case "change-difficulty": {
            if (action.difficulty === state.difficulty) return state;
            if (!state.graph) {
                return {
                    ...state,
                    difficulty: action.difficulty,
                    session: null,
                    notice: null,
                    raceVersion: state.raceVersion + 1,
                    expansionStatus: "idle",
                    expansionSongId: null,
                    expansionError: null,
                };
            }
            return stateForGraph(
                state.mode,
                state.graph,
                state.requestId,
                state.raceVersion + 1,
                action.difficulty,
                state.expandedSongIds,
                action.random,
                state.session?.exploration,
            );
        }
        case "retry-load":
            if (state.mode !== "lastfm") return state;
            return {
                ...state,
                status: "loading",
                graph: null,
                expandedSongIds: [],
                session: null,
                error: null,
                notice: null,
                expansionStatus: "idle",
                expansionSongId: null,
                expansionError: null,
                raceVersion: state.raceVersion + 1,
                requestId: state.requestId + 1,
            };
        case "graph-loaded":
            if (
                state.mode !== "lastfm" ||
                state.status !== "loading" ||
                action.requestId !== state.requestId
            ) {
                return state;
            }
            return stateForGraph(
                "lastfm",
                action.graph,
                state.requestId,
                state.raceVersion + 1,
                state.difficulty,
                action.expandedSongIds ?? [],
            );
        case "load-failed":
            if (
                state.mode !== "lastfm" ||
                state.status !== "loading" ||
                action.requestId !== state.requestId
            ) {
                return state;
            }
            return {
                ...state,
                status: "error",
                graph: null,
                expandedSongIds: [],
                session: null,
                error: action.error,
                notice: null,
            };
        case "restart-race":
            if (
                !state.graph ||
                !state.session ||
                (action.expectedRaceVersion !== undefined &&
                    action.expectedRaceVersion !== state.raceVersion)
            ) {
                return state;
            }
            return {
                ...state,
                notice: null,
                expansionStatus: "idle",
                expansionSongId: null,
                expansionError: null,
                raceVersion: state.raceVersion + 1,
                session: {
                    ...state.session,
                    gameState: createGame(
                        state.graph,
                        state.session.race.startSongId,
                        state.session.race.targetSongId,
                    ),
                },
            };
        case "new-race":
            if (
                !state.graph ||
                state.raceKind !== "random" ||
                (action.expectedRaceVersion !== undefined &&
                    action.expectedRaceVersion !== state.raceVersion)
            ) {
                return state;
            }
            {
                const session = createRaceSession(state.graph, {
                    difficulty: state.difficulty,
                    random: action.random,
                    excludeRace: state.session?.race,
                    previousExploration: state.session?.exploration,
                    expandedSongIds: state.expandedSongIds,
                });
                if (!session) {
                    return state.session
                        ? {
                              ...state,
                              notice:
                                  "No other race is available at this difficulty. Your current race is unchanged.",
                          }
                        : state;
                }
                return {
                    ...state,
                    raceKind: "random",
                    status: "ready",
                    session,
                    notice: null,
                    expansionStatus: "idle",
                    expansionSongId: null,
                    expansionError: null,
                    raceVersion: state.raceVersion + 1,
                };
            }
        case "start-custom-race": {
            if (
                action.startSong.id === action.targetSong.id ||
                !action.startSong.id.trim() ||
                !action.targetSong.id.trim()
            ) {
                return state;
            }

            const graph: SongGraph = {
                nodes: new Map([
                    [action.startSong.id, { ...action.startSong }],
                    [action.targetSong.id, { ...action.targetSong }],
                ]),
                edges: new Map([
                    [action.startSong.id, []],
                    [action.targetSong.id, []],
                ]),
            };
            const race: RaceSession["race"] = {
                startSongId: action.startSong.id,
                targetSongId: action.targetSong.id,
                optimalMoves: null,
            };
            const session: RaceSession = {
                race,
                gameState: createGame(graph, race.startSongId, race.targetSongId),
                exploration: initializeExplorationGraph(
                    graph,
                    race.startSongId,
                    race.targetSongId,
                ),
            };
            const pausedRandomState =
                state.raceKind === "custom"
                    ? state.pausedRandomState
                    : {
                          mode: state.mode,
                          difficulty: state.difficulty,
                          status: state.status,
                          graph: state.graph,
                          expandedSongIds: [...state.expandedSongIds],
                          session: state.session,
                          error: state.error,
                          notice: state.notice,
                      };

            return {
                ...state,
                raceKind: "custom",
                pausedRandomState,
                status: "ready",
                graph,
                expandedSongIds: [],
                session,
                error: null,
                notice: null,
                expansionStatus: "idle",
                expansionSongId: null,
                expansionError: null,
                raceVersion: state.raceVersion + 1,
            };
        }
        case "leave-custom-race":
            if (state.raceKind !== "custom") return state;
            if (state.pausedRandomState) {
                return {
                    ...state,
                    ...state.pausedRandomState,
                    raceKind: "random",
                    pausedRandomState: null,
                    expansionStatus: "idle",
                    expansionSongId: null,
                    expansionError: null,
                    raceVersion: state.raceVersion + 1,
                };
            }
            return {
                ...stateForGraph(
                    "demo",
                    mockGraph,
                    state.requestId,
                    state.raceVersion + 1,
                    state.difficulty,
                    [...mockGraph.nodes.keys()],
                ),
            };
        case "move":
            if (!state.graph || !state.session) return state;
            {
                const nextState = makeMove(
                    state.session.exploration.graph,
                    state.session.gameState,
                    action.songId,
                );
                return nextState
                    ? {
                          ...state,
                          notice: null,
                          expansionStatus: "idle",
                          expansionSongId: null,
                          expansionError: null,
                          session: { ...state.session, gameState: nextState },
                      }
                    : state;
            }
        case "back":
            if (
                !state.session ||
                (action.expectedCurrentSongId !== undefined &&
                    action.expectedCurrentSongId !==
                        state.session.gameState.currentSongId)
            ) {
                return state;
            }
            {
                const previousState = backtrack(state.session.gameState);
                if (!previousState) return state;
                return {
                    ...state,
                    notice: null,
                    expansionStatus: "idle",
                    expansionSongId: null,
                    expansionError: null,
                    raceVersion: state.raceVersion + 1,
                    session: {
                        ...state.session,
                        gameState: previousState,
                    },
                };
            }
        case "expansion-started":
            if (
                (state.mode !== "lastfm" && state.raceKind !== "custom") ||
                !state.session ||
                action.raceVersion !== state.raceVersion ||
                activeSongId(state) !== action.songId ||
                !songRequiresExpansion(state.session.exploration, action.songId) ||
                state.expansionStatus === "loading"
            ) {
                return state;
            }
            return {
                ...state,
                expansionStatus: "loading",
                expansionSongId: action.songId,
                expansionError: null,
            };
        case "expansion-succeeded":
            if (
                (state.mode !== "lastfm" && state.raceKind !== "custom") ||
                !state.session ||
                state.expansionStatus !== "loading" ||
                action.raceVersion !== state.raceVersion ||
                state.expansionSongId !== action.songId ||
                activeSongId(state) !== action.songId
            ) {
                return state;
            }
            {
                const merged = mergeRecommendations(
                    state.session.exploration,
                    action.songId,
                    action.songs,
                );
                const exploration = markSongExpanded(merged, action.songId);
                return {
                    ...state,
                    expansionStatus: "idle",
                    expansionSongId: null,
                    expansionError: null,
                    session: { ...state.session, exploration },
                };
            }
        case "expansion-failed":
            if (
                (state.mode !== "lastfm" && state.raceKind !== "custom") ||
                !state.session ||
                state.expansionStatus !== "loading" ||
                action.raceVersion !== state.raceVersion ||
                state.expansionSongId !== action.songId ||
                activeSongId(state) !== action.songId
            ) {
                return state;
            }
            return {
                ...state,
                expansionStatus: "error",
                expansionError: action.error,
            };
        case "retry-expansion":
            if (state.expansionStatus !== "error") return state;
            return {
                ...state,
                expansionStatus: "idle",
                expansionSongId: null,
                expansionError: null,
            };
    }
}
