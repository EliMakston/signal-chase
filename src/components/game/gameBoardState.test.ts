import { afterEach, describe, expect, it, vi } from "vitest";
import {
    createInitialGameBoardState,
    fetchLastFmGraphData,
    fetchLastFmGraph,
    fetchLastFmSimilarSongs,
    gameBoardReducer,
    LASTFM_SEED_SONG_ID,
    triggerCurrentSongExpansion,
} from "./gameBoardState";
import {
    initializeExplorationGraph,
    songRequiresExpansion,
} from "../../game/explorationGraph";
import { createGame, getAvailableMoves } from "../../game/gameEngine";
import type { SongGraph } from "../../game/types";
import {
    DEFAULT_DEMO_GRAPH_ID,
    demoGraphRegistry,
} from "../../game/demoGraphs";
import { findShortestPath } from "../../game/pathfinding";

const serializedGraph = {
    songs: [
        { id: "a", title: "A", artist: "Band", albumArt: "" },
        { id: "b", title: "B", artist: "Band", albumArt: "" },
        { id: "c", title: "C", artist: "Band", albumArt: "" },
        { id: "d", title: "D", artist: "Band", albumArt: "" },
    ],
    edges: [
        { songId: "a", recommendations: ["b"] },
        { songId: "b", recommendations: ["c"] },
        { songId: "c", recommendations: ["d"] },
        { songId: "d", recommendations: [] },
    ],
};

const serializedLastFmGraph = {
    songs: [
        {
            id: "lastfm:Artist:Song%20A",
            title: "Song A",
            artist: "Artist",
            albumArt: "",
        },
        {
            id: "lastfm:Artist:Song%20B",
            title: "Song B",
            artist: "Artist",
            albumArt: "",
        },
    ],
    edges: [
        { songId: "lastfm:Artist:Song%20A", recommendations: ["lastfm:Artist:Song%20B"] },
        { songId: "lastfm:Artist:Song%20B", recommendations: [] },
    ],
};

afterEach(() => {
    vi.useRealTimers();
});

function createInitialLiveCustomState() {
    return gameBoardReducer(createInitialGameBoardState(), {
        type: "change-mode",
        mode: "lastfm",
    });
}

describe("game board data state", () => {
    it("starts in Demo mode with a playable game", () => {
        const state = createInitialGameBoardState();

        expect(state.mode).toBe("demo");
        expect(state.demoGraphId).toBe(DEFAULT_DEMO_GRAPH_ID);
        expect(state.graph?.nodes.size).toBe(40);
        expect(state.status).toBe("ready");
        expect(state.session?.gameState.moves).toBe(0);
    });

    it("generates races for every difficulty in all six curated networks", () => {
        for (const definition of demoGraphRegistry) {
            let state = createInitialGameBoardState(() => 0);
            if (definition.id !== DEFAULT_DEMO_GRAPH_ID) {
                state = gameBoardReducer(state, {
                    type: "change-demo-graph",
                    selection: definition.id,
                    random: () => 0,
                });
            }

            expect(state.demoGraphId).toBe(definition.id);
            expect(state.graph).toBe(definition.graph);
            expect(state.status).toBe("ready");

            for (const [difficulty, minMoves, maxMoves] of [
                ["easy", 2, 3],
                ["medium", 3, 4],
                ["hard", 4, 5],
            ] as const) {
                state = gameBoardReducer(state, {
                    type: "change-difficulty",
                    difficulty,
                    random: () => 0,
                });
                expect(state.session?.race.optimalMoves).toBeGreaterThanOrEqual(
                    minMoves,
                );
                expect(state.session?.race.optimalMoves).toBeLessThanOrEqual(
                    maxMoves,
                );
            }
        }
    });

    it("starts offline custom races on the full directed graph in all six networks", () => {
        for (const definition of demoGraphRegistry) {
            const pathStart = [...definition.graph.nodes.keys()][0];
            const target = [...definition.graph.nodes.keys()].find((songId) => {
                const path = findShortestPath(definition.graph, pathStart, songId);
                return path !== null && path.length > 1;
            });
            expect(target).toBeDefined();
            const path = findShortestPath(definition.graph, pathStart, target!);
            let state = createInitialGameBoardState();
            if (definition.id !== DEFAULT_DEMO_GRAPH_ID) {
                state = gameBoardReducer(state, {
                    type: "change-demo-graph",
                    selection: definition.id,
                    random: () => 0,
                });
            }

            const started = gameBoardReducer(state, {
                type: "start-custom-race",
                startSong: definition.graph.nodes.get(pathStart)!,
                targetSong: definition.graph.nodes.get(target!)!,
            });
            expect(started.raceKind).toBe("custom");
            expect(started.graph).toBe(definition.graph);
            expect(started.session?.race.optimalMoves).toBe(path!.length - 1);
            expect(started.session?.gameState.moves).toBe(0);
            expect(started.session?.exploration.expandedSongIds.size).toBe(40);
            expect(started.session?.exploration.originalShortestPathDistance).toBe(
                path!.length - 1,
            );
        }
    });

    it("rejects Demo custom endpoints outside the active graph or without a directed route", () => {
        const initial = createInitialGameBoardState();
        const outsideGraph = gameBoardReducer(initial, {
            type: "start-custom-race",
            startSong: { id: "foreign:start", title: "Start", artist: "Band", albumArt: "" },
            targetSong: { id: "foreign:target", title: "Target", artist: "Band", albumArt: "" },
        });
        expect(outsideGraph.raceKind).toBe("random");
        expect(outsideGraph.notice).toMatch(/must belong to the active Demo network/);

        const startSong = { id: "offline:start", title: "Start", artist: "Band", albumArt: "" };
        const targetSong = { id: "offline:target", title: "Target", artist: "Band", albumArt: "" };
        const disconnected = {
            ...initial,
            graph: {
                nodes: new Map([
                    [startSong.id, startSong],
                    [targetSong.id, targetSong],
                ]),
                edges: new Map([
                    [startSong.id, []],
                    [targetSong.id, []],
                ]),
            },
        };
        const unreachable = gameBoardReducer(disconnected, {
            type: "start-custom-race",
            startSong,
            targetSong,
        });
        expect(unreachable.raceKind).toBe("random");
        expect(unreachable.notice).toMatch(/No directed route connects/);
    });

    it("keeps all Demo songs expanded so custom play never fetches recommendations", () => {
        const graph = demoGraphRegistry[0].graph;
        const [startId, targetId] = [...graph.nodes.keys()];
        const started = gameBoardReducer(createInitialGameBoardState(), {
            type: "start-custom-race",
            startSong: graph.nodes.get(startId)!,
            targetSong: graph.nodes.get(targetId)!,
        });
        const fetcher = vi.fn<typeof fetch>();
        const triggered = triggerCurrentSongExpansion(started, vi.fn(), fetcher);
        expect(triggered).toBe(false);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("switches networks with a fresh race and no old graph or exploration state", () => {
        const initial = createInitialGameBoardState();
        const switched = gameBoardReducer(initial, {
            type: "change-demo-graph",
            selection: "classic-rock",
            random: () => 0,
        });

        expect(switched.mode).toBe("demo");
        expect(switched.demoGraphId).toBe("classic-rock");
        expect(switched.demoGraphSelection).toBe("classic-rock");
        expect(switched.graph).toBe(
            demoGraphRegistry.find(({ id }) => id === "classic-rock")?.graph,
        );
        expect(switched.graph?.nodes.size).toBe(40);
        expect(
            [...switched.graph!.nodes.keys()].every((id) =>
                id.startsWith("classic-rock:"),
            ),
        ).toBe(true);
        expect(switched.session?.exploration.originalRaceGraph.nodes.size).toBe(40);
        expect(switched.session?.gameState.moves).toBe(0);
        expect(switched.requestId).toBe(initial.requestId + 1);
        expect(switched.raceVersion).toBe(initial.raceVersion + 1);
    });

    it("keeps the selected graph and exact race on Restart", () => {
        const selected = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-demo-graph",
            selection: "pop",
            random: () => 0,
        });
        const moved = gameBoardReducer(selected, {
            type: "move",
            songId: selected.graph!.edges.get(
                selected.session!.gameState.currentSongId,
            )![0],
        });
        const restarted = gameBoardReducer(moved, { type: "restart-race" });

        expect(restarted.graph).toBe(selected.graph);
        expect(restarted.demoGraphId).toBe("pop");
        expect(restarted.session?.race).toEqual(selected.session?.race);
        expect(restarted.session?.gameState.moves).toBe(0);
    });

    it("lets Surprise Me choose a network and changes network only on New Race, not Restart", () => {
        const selected = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-demo-graph",
            selection: "surprise-me",
            random: () => 0,
        });
        expect(selected.demoGraphSelection).toBe("surprise-me");
        expect(selected.demoGraphId).not.toBe(DEFAULT_DEMO_GRAPH_ID);
        const selectedId = selected.demoGraphId;
        const selectedRace = selected.session?.race;

        const restarted = gameBoardReducer(selected, { type: "restart-race" });
        expect(restarted.demoGraphId).toBe(selectedId);
        expect(restarted.session?.race).toEqual(selectedRace);

        const nextRace = gameBoardReducer(restarted, {
            type: "new-race",
            random: () => 0,
        });
        expect(nextRace.demoGraphSelection).toBe("surprise-me");
        expect(nextRace.demoGraphId).not.toBe(selectedId);
        expect(nextRace.session?.race).toBeDefined();
        expect(nextRace.session?.gameState.moves).toBe(0);
        expect(nextRace.graph?.nodes.size).toBe(40);
    });

    it("ignores stale Last.fm graph results after returning to Demo and switching networks", () => {
        const initial = createInitialGameBoardState();
        const loading = gameBoardReducer(initial, {
            type: "change-mode",
            mode: "lastfm",
        });
        const demo = gameBoardReducer(loading, {
            type: "change-mode",
            mode: "demo",
        });
        const switched = gameBoardReducer(demo, {
            type: "change-demo-graph",
            selection: "electronic",
            random: () => 0,
        });
        const stale = gameBoardReducer(switched, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph: fetchGraphFixture(),
        });

        expect(stale).toBe(switched);
        expect(stale.demoGraphId).toBe("electronic");
        expect(stale.graph?.nodes.size).toBe(40);
        expect([...stale.graph!.nodes.keys()].every((id) =>
            id.startsWith("electronic:"),
        )).toBe(true);
    });

    it("enters a clear loading state when switching to Last.fm", () => {
        const initial = createInitialGameBoardState();
        const state = gameBoardReducer(initial, {
            type: "change-mode",
            mode: "lastfm",
        });

        expect(state).toMatchObject({
            mode: "lastfm",
            status: "loading",
            graph: null,
            session: null,
            error: null,
            requestId: initial.requestId + 1,
        });
    });

    it("requests and deserializes the fixed Last.fm seed through URLSearchParams", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify(serializedLastFmGraph), { status: 200 }),
        );

        const graph = await fetchLastFmGraph(fetcher);

        expect([...graph.nodes.keys()]).toEqual([
            "lastfm:Artist:Song%20A",
            "lastfm:Artist:Song%20B",
        ]);
        const [requestUrl] = fetcher.mock.calls[0];
        const url = new URL(String(requestUrl), "https://game.test");
        expect(url.pathname).toBe("/api/music/graph");
        expect(url.searchParams.get("seedSongId")).toBe(LASTFM_SEED_SONG_ID);
    });

    it("loads optional expansion metadata and accepts older graph responses without it", async () => {
        const withMetadata = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    ...serializedLastFmGraph,
                    expandedSongIds: ["lastfm:Artist:Song%20A"],
                }),
                { status: 200 },
            ),
        );
        const loaded = await fetchLastFmGraphData(withMetadata);
        expect(loaded.expandedSongIds).toEqual(["lastfm:Artist:Song%20A"]);
        expect(loaded.graph.nodes.size).toBe(2);

        const legacy = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify(serializedLastFmGraph), { status: 200 }),
        );
        await expect(fetchLastFmGraphData(legacy)).resolves.toMatchObject({
            expandedSongIds: [],
        });
    });

    it("rejects expansion metadata that is duplicated or names missing songs", async () => {
        for (const expandedSongIds of [
            [
                "lastfm:Artist:Song%20A",
                "lastfm:Artist:Song%20A",
            ],
            ["lastfm:Artist:Missing"],
        ]) {
            const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        ...serializedLastFmGraph,
                        expandedSongIds,
                    }),
                    { status: 200 },
                ),
            );
            await expect(fetchLastFmGraphData(fetcher)).rejects.toThrow(
                "expansion metadata is invalid",
            );
        }
    });

    it("rejects graph songs with malformed Last.fm IDs", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    ...serializedLastFmGraph,
                    songs: [
                        {
                            ...serializedLastFmGraph.songs[0],
                            id: "lastfm:Artist:%E0%A4%A",
                        },
                        serializedLastFmGraph.songs[1],
                    ],
                    edges: [],
                }),
                { status: 200 },
            ),
        );
        await expect(fetchLastFmGraphData(fetcher)).rejects.toThrow(
            "Last.fm graph returned invalid song data",
        );
    });

    it("fetches the /similar response envelope and safely rejects malformed songs", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    songs: [
                        { id: "lastfm:Artist:Track", title: "Track", artist: "Artist", albumArt: "" },
                    ],
                }),
                { status: 200 },
            ),
        );
        const graph = fetchGraphFixture();
        await expect(
            fetchLastFmSimilarSongs(graph, "lastfm:Artist:Track", fetcher),
        ).resolves.toEqual([
            { id: "lastfm:Artist:Track", title: "Track", artist: "Artist", albumArt: "" },
        ]);
        const [requestUrl] = fetcher.mock.calls[0];
        const url = new URL(String(requestUrl), "https://game.test");
        expect(url.pathname).toBe("/api/music/similar");
        expect(url.searchParams.get("songId")).toBe("lastfm:Artist:Track");

        const malformed = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ songs: [{ id: "invalid" }] }), { status: 200 }),
        );
        await expect(
            fetchLastFmSimilarSongs({ ...graph, nodes: new Map(graph.nodes) }, "invalid", malformed),
        ).rejects.toThrow("must contain a songs array");
    });

    it("coalesces concurrent similar-song requests for the same graph and song", async () => {
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const fetcher = vi.fn<typeof fetch>(async () => {
            await gate;
            return new Response(JSON.stringify({ songs: [] }), { status: 200 });
        });
        const graph = fetchGraphFixture();
        const first = fetchLastFmSimilarSongs(graph, "lastfm:Artist:Track", fetcher);
        const second = fetchLastFmSimilarSongs(graph, "lastfm:Artist:Track", fetcher);
        expect(fetcher).toHaveBeenCalledTimes(1);
        release?.();
        await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
    });

    it("releases failed similar-song requests so retry can succeed", async () => {
        const graph = fetchGraphFixture();
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ error: "upstream unavailable" }), {
                    status: 502,
                }),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        songs: [
                            {
                                id: "lastfm:Band:Retry",
                                title: "Retry",
                                artist: "Band",
                                albumArt: "",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            );

        await expect(
            fetchLastFmSimilarSongs(graph, "lastfm:Artist:Retry", fetcher),
        ).rejects.toThrow("Last.fm is temporarily unavailable.");
        await expect(
            fetchLastFmSimilarSongs(graph, "lastfm:Artist:Retry", fetcher),
        ).resolves.toHaveLength(1);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("releases a rejected aborted request so the same song can be retried", async () => {
        const graph = fetchGraphFixture();
        const fetcher = vi
            .fn<typeof fetch>()
            .mockRejectedValueOnce(new DOMException("Aborted", "AbortError"))
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ songs: [] }), { status: 200 }),
            );
        await expect(
            fetchLastFmSimilarSongs(graph, "lastfm:Artist:Track", fetcher),
        ).rejects.toMatchObject({ name: "AbortError" });
        await expect(
            fetchLastFmSimilarSongs(graph, "lastfm:Artist:Track", fetcher),
        ).resolves.toEqual([]);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("times out a hung similar request and clears its deduplication entry", async () => {
        vi.useFakeTimers();
        const graph = fetchGraphFixture();
        const fetcher = vi
            .fn<typeof fetch>()
            .mockImplementationOnce(
                (_input, init) =>
                    new Promise<Response>((_resolve, reject) => {
                        init?.signal?.addEventListener("abort", () =>
                            reject(new DOMException("Aborted", "AbortError")),
                        );
                    }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ songs: [] }), { status: 200 }),
            );
        const pending = fetchLastFmSimilarSongs(
            graph,
            "lastfm:Artist:Track",
            fetcher,
        );
        const timeoutAssertion = expect(pending).rejects.toThrow(
            "Recommendation request timed out",
        );
        await vi.advanceTimersByTimeAsync(30_000);
        await timeoutAssertion;

        await expect(
            fetchLastFmSimilarSongs(graph, "lastfm:Artist:Track", fetcher),
        ).resolves.toEqual([]);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("rejects malformed Last.fm song IDs and empty metadata in similar responses", async () => {
        const graph = fetchGraphFixture();
        for (const song of [
            { id: "lastfm:Artist:%E0%A4%A", title: "Track", artist: "Artist", albumArt: "" },
            { id: "lastfm:Artist:Track", title: " ", artist: "Artist", albumArt: "" },
            { id: "lastfm:Artist:Track", title: "Track", artist: "", albumArt: "" },
        ]) {
            const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
                new Response(JSON.stringify({ songs: [song] }), { status: 200 }),
            );
            await expect(
                fetchLastFmSimilarSongs(graph, "lastfm:Artist:Track", fetcher),
            ).rejects.toThrow("must contain a songs array");
        }
    });

    it("exposes request failures as a retryable error state", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ error: "Failed to build song graph" }), {
                status: 502,
            }),
        );
        await expect(fetchLastFmGraph(fetcher)).rejects.toThrow(
            "Could not load Last.fm graph: Last.fm is temporarily unavailable.",
        );

        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const failed = gameBoardReducer(loading, {
            type: "load-failed",
            requestId: loading.requestId,
            error: "Could not load Last.fm graph: Last.fm is temporarily unavailable.",
        });
        const retry = gameBoardReducer(failed, { type: "retry-load" });

        expect(failed.status).toBe("error");
        expect(failed.error).toContain("Last.fm is temporarily unavailable");
        expect(retry.status).toBe("loading");
        expect(retry.requestId).toBe(loading.requestId + 1);
    });

    it("ignores stale async results after switching modes or retrying", () => {
        const lastFmLoading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const demo = gameBoardReducer(lastFmLoading, {
            type: "change-mode",
            mode: "demo",
        });
        const staleResult = gameBoardReducer(demo, {
            type: "load-failed",
            requestId: lastFmLoading.requestId,
            error: "stale failure",
        });

        expect(staleResult).toBe(demo);
        expect(staleResult.mode).toBe("demo");
        expect(staleResult.status).toBe("ready");

        const reloading = gameBoardReducer(lastFmLoading, { type: "retry-load" });
        const oldSuccess = gameBoardReducer(reloading, {
            type: "graph-loaded",
            requestId: lastFmLoading.requestId,
            graph: {} as SongGraph,
        });
        expect(oldSuccess).toBe(reloading);
    });

    it("initializes a playable Last.fm race from the loaded graph", () => {
        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const initialized = gameBoardReducer(loading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph: fetchGraphFixture(),
        });

        expect(initialized.mode).toBe("lastfm");
        expect(initialized.status).toBe("ready");
        expect(initialized.session?.gameState).toMatchObject({
            moves: 0,
            status: "playing",
            currentSongId: initialized.session?.race.startSongId,
            startSongId: initialized.session?.race.startSongId,
            targetSongId: initialized.session?.race.targetSongId,
            visitedSongs: [initialized.session?.race.startSongId],
        });
        expect(initialized.graph?.nodes.size).toBe(4);
    });

    it("uses graph expansion metadata to avoid refetching songs already expanded", () => {
        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const graph = fetchGraphFixture();
        const firstInitialization = gameBoardReducer(loading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph,
        });
        const currentSongId = firstInitialization.session!.gameState.currentSongId;
        const initialized = gameBoardReducer(loading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph,
            expandedSongIds: [currentSongId],
        });

        expect(initialized.session?.exploration.expandedSongIds.has(currentSongId))
            .toBe(true);
        expect(
            songRequiresExpansion(
                initialized.session!.exploration,
                currentSongId,
            ),
        ).toBe(false);
    });

    it("reuses the loaded graph for Restart and New Race", () => {
        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const loaded = gameBoardReducer(loading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph: fetchGraphFixture(),
        });
        const graph = loaded.graph;
        const restarted = gameBoardReducer(loaded, { type: "restart-race" });
        const newRace = gameBoardReducer(restarted, { type: "new-race" });

        expect(restarted.graph).toBe(graph);
        expect(newRace.graph).toBe(graph);
        expect(newRace.status).toBe("ready");
        expect(newRace.requestId).toBe(loaded.requestId);
    });

    it("resets the race when difficulty changes without replacing the graph", () => {
        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const loaded = gameBoardReducer(loading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph: fetchGraphFixture(),
        });
        const changed = gameBoardReducer(loaded, {
            type: "change-difficulty",
            difficulty: "medium",
            random: () => 0,
        });

        expect(changed.graph).toBe(loaded.graph);
        expect(changed.requestId).toBe(loaded.requestId);
        expect(changed.difficulty).toBe("medium");
        expect(changed.session?.gameState.moves).toBe(0);
        expect(changed.session?.race.optimalMoves).toBeGreaterThanOrEqual(3);
        expect(changed.session?.race.optimalMoves).toBeLessThanOrEqual(4);
    });

    it("shows a no-race state for an unavailable difficulty and recovers without refetching", () => {
        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const initial = gameBoardReducer(loading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph: fetchGraphFixture(),
        });
        const hard = gameBoardReducer(initial, {
            type: "change-difficulty",
            difficulty: "hard",
        });

        expect(hard.status).toBe("no-race");
        expect(hard.graph).toBe(initial.graph);
        expect(hard.requestId).toBe(initial.requestId);

        const easy = gameBoardReducer(hard, {
            type: "change-difficulty",
            difficulty: "easy",
            random: () => 0,
        });
        expect(easy.status).toBe("ready");
        expect(easy.graph).toBe(initial.graph);
        expect(easy.requestId).toBe(initial.requestId);
    });

    it("uses a difficulty selected during loading when the graph arrives", () => {
        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const changedWhileLoading = gameBoardReducer(loading, {
            type: "change-difficulty",
            difficulty: "medium",
        });
        const loaded = gameBoardReducer(changedWhileLoading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph: fetchGraphFixture(),
        });

        expect(loaded.mode).toBe("lastfm");
        expect(loaded.difficulty).toBe("medium");
        expect(loaded.status).toBe("ready");
        expect(loaded.session?.race.optimalMoves).toBe(3);
    });

    it("keeps the current pair on Restart and selects a different pair on New Race", () => {
        const initial = createInitialGameBoardState();
        const currentRace = initial.session!.race;
        const moved = gameBoardReducer(initial, {
            type: "move",
            songId: initial.graph!.edges.get(initial.session!.gameState.currentSongId)![0],
        });
        const restarted = gameBoardReducer(moved, { type: "restart-race" });
        const nextRace = gameBoardReducer(restarted, {
            type: "new-race",
            random: () => 0,
        });

        expect(restarted.session?.race).toEqual(currentRace);
        expect(restarted.session?.gameState.moves).toBe(0);
        expect(nextRace.session?.race).not.toEqual(currentRace);
        expect(nextRace.session?.gameState.moves).toBe(0);
        expect(nextRace.graph).toBe(initial.graph);
        expect(nextRace.requestId).toBe(initial.requestId);
    });

    it("ignores duplicate Back and New Race actions from stale UI state", () => {
        const initial = createInitialGameBoardState();
        const startSongId = initial.session!.gameState.currentSongId;
        const nextRace = gameBoardReducer(initial, {
            type: "new-race",
            expectedRaceVersion: initial.raceVersion,
            random: () => 0,
        });
        const duplicateNewRace = gameBoardReducer(nextRace, {
            type: "new-race",
            expectedRaceVersion: initial.raceVersion,
            random: () => 0,
        });
        expect(duplicateNewRace).toBe(nextRace);

        const moveTarget = initial.graph!.edges.get(startSongId)![0];
        const moved = gameBoardReducer(initial, {
            type: "move",
            songId: moveTarget,
        });
        const expectedCurrentSongId = moved.session!.gameState.currentSongId;
        const backed = gameBoardReducer(moved, {
            type: "back",
            expectedCurrentSongId,
        });
        const duplicateBack = gameBoardReducer(backed, {
            type: "back",
            expectedCurrentSongId,
        });

        expect(backed.session?.gameState.currentSongId).toBe(startSongId);
        expect(duplicateBack).toBe(backed);
    });

    it("merges successful recommendations and marks the active song expanded", () => {
        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const loaded = gameBoardReducer(loading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph: fetchGraphFixture(),
            expandedSongIds: [],
        });
        const songId = loaded.session!.gameState.currentSongId;
        const started = gameBoardReducer(loaded, {
            type: "expansion-started",
            raceVersion: loaded.raceVersion,
            songId,
        });
        const expanded = gameBoardReducer(started, {
            type: "expansion-succeeded",
            raceVersion: loaded.raceVersion,
            songId,
            songs: [
                { id: "new-song", title: "New", artist: "Band", albumArt: "" },
                { id: "new-song", title: "Duplicate", artist: "Band", albumArt: "" },
                { id: songId, title: "Cycle", artist: "Band", albumArt: "" },
                { id: songId, title: "Duplicate cycle edge", artist: "Band", albumArt: "" },
            ],
        });

        expect(expanded.expansionStatus).toBe("idle");
        expect(expanded.session?.exploration.expandedSongIds.has(songId)).toBe(true);
        expect(expanded.session?.exploration.graph.edges.get(songId)).toContain(
            "new-song",
        );
        expect(expanded.session?.exploration.graph.edges.get(songId)).toContain(
            songId,
        );
        expect(
            expanded.session?.exploration.graph.edges.get(songId)?.filter(
                (recommendationId) => recommendationId === songId,
            ),
        ).toHaveLength(1);
        expect(expanded.session?.exploration.graph.nodes.size).toBe(5);
        expect(songRequiresExpansion(expanded.session!.exploration, songId)).toBe(
            false,
        );
    });

    it("fetches recommendations after navigating to an initially unexpanded song", async () => {
        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const graph = fetchGraphFixture();
        const loaded = gameBoardReducer(loading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph,
            expandedSongIds: ["a"],
        });
        const playing = {
            ...loaded,
            session: {
                ...loaded.session!,
                race: {
                    startSongId: "a",
                    targetSongId: "d",
                    optimalMoves: 3,
                },
                gameState: createGame(graph, "a", "d"),
                exploration: initializeExplorationGraph(graph, "a", "d", ["a"]),
            },
        };
        const moved = gameBoardReducer(playing, { type: "move", songId: "b" });
        expect(moved.session?.gameState.currentSongId).toBe("b");
        expect(songRequiresExpansion(moved.session!.exploration, "b")).toBe(true);

        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    songs: [
                        {
                            id: "lastfm:New:Song",
                            title: "New Song",
                            artist: "Band",
                            albumArt: "",
                        },
                    ],
                }),
                { status: 200 },
            ),
        );
        let current = moved;
        const triggered = triggerCurrentSongExpansion(
            current,
            (action) => {
                current = gameBoardReducer(current, action);
            },
            fetcher,
        );

        expect(triggered).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1);
        const [requestUrl] = fetcher.mock.calls[0];
        const url = new URL(String(requestUrl), "https://game.test");
        expect(url.pathname).toBe("/api/music/similar");
        expect(url.searchParams.get("songId")).toBe("b");

        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(current.session?.exploration.expandedSongIds.has("b")).toBe(true);
        expect(current.session?.exploration.graph.nodes.has("lastfm:New:Song")).toBe(true);
        expect(current.expansionStatus).toBe("idle");
    });

    it("marks an empty successful result expanded without inventing recommendations", () => {
        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const loaded = gameBoardReducer(loading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph: fetchGraphFixture(),
            expandedSongIds: [],
        });
        const songId = loaded.session!.gameState.currentSongId;
        const existingRecommendations =
            loaded.session!.exploration.graph.edges.get(songId);
        const started = gameBoardReducer(loaded, {
            type: "expansion-started",
            raceVersion: loaded.raceVersion,
            songId,
        });
        const expanded = gameBoardReducer(started, {
            type: "expansion-succeeded",
            raceVersion: loaded.raceVersion,
            songId,
            songs: [],
        });

        expect(expanded.session?.exploration.graph.edges.get(songId)).toEqual(
            existingRecommendations,
        );
        expect(expanded.session?.exploration.expandedSongIds.has(songId)).toBe(true);
        expect(expanded.expansionStatus).toBe("idle");
    });

    it("leaves failed songs unexpanded and supports retry without losing the race", () => {
        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const loaded = gameBoardReducer(loading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph: fetchGraphFixture(),
            expandedSongIds: [],
        });
        const songId = loaded.session!.gameState.currentSongId;
        const started = gameBoardReducer(loaded, {
            type: "expansion-started",
            raceVersion: loaded.raceVersion,
            songId,
        });
        const failed = gameBoardReducer(started, {
            type: "expansion-failed",
            raceVersion: loaded.raceVersion,
            songId,
            error: "Network unavailable",
        });
        const retried = gameBoardReducer(failed, { type: "retry-expansion" });

        expect(failed.status).toBe("ready");
        expect(failed.session?.race).toEqual(loaded.session?.race);
        expect(failed.session?.exploration.expandedSongIds.has(songId)).toBe(false);
        expect(failed.expansionError).toBe("Network unavailable");
        expect(retried.expansionStatus).toBe("idle");
        expect(retried.session).toBe(failed.session);
        expect(retried.session?.exploration.expandedSongIds.has(songId)).toBe(false);
    });

    it("ignores expansion responses after restart, new race, difficulty, or mode changes", () => {
        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const loaded = gameBoardReducer(loading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph: fetchGraphFixture(),
        });
        const songId = loaded.session!.gameState.currentSongId;
        const started = gameBoardReducer(loaded, {
            type: "expansion-started",
            raceVersion: loaded.raceVersion,
            songId,
        });
        const restarted = gameBoardReducer(started, { type: "restart-race" });
        const stale = gameBoardReducer(restarted, {
            type: "expansion-succeeded",
            raceVersion: started.raceVersion,
            songId,
            songs: [{ id: "stale", title: "Stale", artist: "Band", albumArt: "" }],
        });

        expect(stale).toBe(restarted);
        expect(stale.session?.exploration.graph.nodes.has("stale")).toBe(false);

        const nextRace = gameBoardReducer(started, {
            type: "new-race",
            random: () => 0,
        });
        const staleAfterNewRace = gameBoardReducer(nextRace, {
            type: "expansion-succeeded",
            raceVersion: started.raceVersion,
            songId,
            songs: [{ id: "stale-new-race", title: "Stale", artist: "Band", albumArt: "" }],
        });
        expect(staleAfterNewRace).toBe(nextRace);

        const difficultyChanged = gameBoardReducer(started, {
            type: "change-difficulty",
            difficulty: "medium",
        });
        const staleAfterDifficulty = gameBoardReducer(difficultyChanged, {
            type: "expansion-succeeded",
            raceVersion: started.raceVersion,
            songId,
            songs: [{ id: "stale-difficulty", title: "Stale", artist: "Band", albumArt: "" }],
        });
        expect(staleAfterDifficulty).toBe(difficultyChanged);

        const switchedToDemo = gameBoardReducer(started, {
            type: "change-mode",
            mode: "demo",
        });
        const staleAfterMode = gameBoardReducer(switchedToDemo, {
            type: "expansion-succeeded",
            raceVersion: started.raceVersion,
            songId,
            songs: [{ id: "stale-mode", title: "Stale", artist: "Band", albumArt: "" }],
        });
        expect(staleAfterMode).toBe(switchedToDemo);
    });

    it("ignores a previous song's response while a later song's expansion is pending", () => {
        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const graph = fetchGraphFixture();
        const loaded = gameBoardReducer(loading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph,
        });
        const state = {
            ...loaded,
            session: {
                ...loaded.session!,
                race: {
                    startSongId: "a",
                    targetSongId: "d",
                    optimalMoves: 3,
                },
                gameState: createGame(graph, "a", "d"),
                exploration: initializeExplorationGraph(graph, "a", "d"),
            },
        };
        const expansionA = gameBoardReducer(state, {
            type: "expansion-started",
            raceVersion: state.raceVersion,
            songId: "a",
        });
        const movedToB = gameBoardReducer(expansionA, {
            type: "move",
            songId: "b",
        });
        const expansionB = gameBoardReducer(movedToB, {
            type: "expansion-started",
            raceVersion: movedToB.raceVersion,
            songId: "b",
        });
        const staleA = gameBoardReducer(expansionB, {
            type: "expansion-succeeded",
            raceVersion: state.raceVersion,
            songId: "a",
            songs: [{
                id: "lastfm:Stale:Recommendation",
                title: "Stale",
                artist: "Recommendation",
                albumArt: "",
            }],
        });

        expect(staleA).toBe(expansionB);
        expect(staleA.session?.gameState.currentSongId).toBe("b");
        expect(staleA.session?.exploration.expandedSongIds.has("a")).toBe(false);

        const succeededB = gameBoardReducer(expansionB, {
            type: "expansion-succeeded",
            raceVersion: state.raceVersion,
            songId: "b",
            songs: [],
        });
        expect(succeededB.session?.exploration.expandedSongIds.has("b")).toBe(true);
    });

    it("validates moves against recommendations added during exploration", () => {
        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const loaded = gameBoardReducer(loading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph: fetchGraphFixture(),
            expandedSongIds: [],
        });
        const startSongId = loaded.session!.gameState.currentSongId;
        const started = gameBoardReducer(loaded, {
            type: "expansion-started",
            raceVersion: loaded.raceVersion,
            songId: startSongId,
        });
        const expanded = gameBoardReducer(started, {
            type: "expansion-succeeded",
            raceVersion: loaded.raceVersion,
            songId: startSongId,
            songs: [{ id: "dynamic-next", title: "Dynamic", artist: "Band", albumArt: "" }],
        });
        const moved = gameBoardReducer(expanded, {
            type: "move",
            songId: "dynamic-next",
        });

        expect(moved.session?.gameState.currentSongId).toBe("dynamic-next");
        expect(moved.session?.gameState.moves).toBe(1);
        expect(moved.session?.exploration.originalRaceGraph.nodes.has("dynamic-next"))
            .toBe(false);
    });

    it("initializes a minimal custom race without finding a route or building a graph", () => {
        const initial = createInitialLiveCustomState();
        const started = gameBoardReducer(initial, {
            type: "start-custom-race",
            startSong: {
                id: "lastfm:Custom:Start",
                title: "Start",
                artist: "Custom",
                albumArt: "",
            },
            targetSong: {
                id: "lastfm:Custom:Target",
                title: "Target",
                artist: "Custom",
                albumArt: "",
            },
        });

        expect(started.raceKind).toBe("custom");
        expect(started.status).toBe("ready");
        expect([...started.graph!.nodes.keys()]).toEqual([
            "lastfm:Custom:Start",
            "lastfm:Custom:Target",
        ]);
        expect([...started.graph!.edges.values()]).toEqual([[], []]);
        expect(started.session?.race.optimalMoves).toBeNull();
        expect(started.session?.exploration.originalShortestPathDistance).toBeNull();
        expect(started.session?.exploration.expandedSongIds.size).toBe(0);
        expect(started.session?.gameState.currentSongId).toBe("lastfm:Custom:Start");
        expect(started.graph).not.toBe(initial.graph);
    });

    it("immediately expands the custom start and can navigate to victory", async () => {
        const started = gameBoardReducer(createInitialLiveCustomState(), {
            type: "start-custom-race",
            startSong: {
                id: "lastfm:Custom:Start",
                title: "Start",
                artist: "Custom",
                albumArt: "",
            },
            targetSong: {
                id: "lastfm:Custom:Target",
                title: "Target",
                artist: "Custom",
                albumArt: "",
            },
        });
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    songs: [
                        {
                            id: "lastfm:Custom:Target",
                            title: "Target",
                            artist: "Custom",
                            albumArt: "",
                        },
                    ],
                }),
                { status: 200 },
            ),
        );
        let current = started;
        const triggered = triggerCurrentSongExpansion(
            current,
            (action) => {
                current = gameBoardReducer(current, action);
            },
            fetcher,
        );

        expect(triggered).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1);
        const requestUrl = new URL(
            String(fetcher.mock.calls[0][0]),
            "https://game.test",
        );
        expect(requestUrl.pathname).toBe("/api/music/similar");
        expect(requestUrl.searchParams.get("songId")).toBe(
            "lastfm:Custom:Start",
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(current.session?.exploration.expandedSongIds.has(
            "lastfm:Custom:Start",
        )).toBe(true);
        expect(current.session?.exploration.originalShortestPathDistance).toBeNull();

        const won = gameBoardReducer(current, {
            type: "move",
            songId: "lastfm:Custom:Target",
        });
        expect(won.session?.gameState.status).toBe("won");
        expect(won.session?.gameState.moves).toBe(1);
        expect(won.session?.race.optimalMoves).toBeNull();
        expect(won.session?.exploration.originalShortestPathDistance).toBeNull();
    });

    it("handles empty custom recommendations and supports failure retry", async () => {
        const started = gameBoardReducer(createInitialLiveCustomState(), {
            type: "start-custom-race",
            startSong: {
                id: "lastfm:Custom:RetryStart",
                title: "Retry Start",
                artist: "Custom",
                albumArt: "",
            },
            targetSong: {
                id: "lastfm:Custom:RetryTarget",
                title: "Retry Target",
                artist: "Custom",
                albumArt: "",
            },
        });
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ error: "Unavailable" }), {
                    status: 502,
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ songs: [] }), { status: 200 }),
            );
        let current = started;
        triggerCurrentSongExpansion(
            current,
            (action) => {
                current = gameBoardReducer(current, action);
            },
            fetcher,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(current.expansionStatus).toBe("error");
        expect(current.session?.exploration.expandedSongIds.has(
            "lastfm:Custom:RetryStart",
        )).toBe(false);

        current = gameBoardReducer(current, { type: "retry-expansion" });
        triggerCurrentSongExpansion(
            current,
            (action) => {
                current = gameBoardReducer(current, action);
            },
            fetcher,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(current.expansionStatus).toBe("idle");
        expect(current.session?.exploration.expandedSongIds.has(
            "lastfm:Custom:RetryStart",
        )).toBe(true);
        expect(current.session?.exploration.graph.edges.get(
            "lastfm:Custom:RetryStart",
        )).toEqual([]);
    });

    it("preserves custom exploration on restart and restores random state on New Custom Race", () => {
        const random = createInitialLiveCustomState();
        const custom = gameBoardReducer(random, {
            type: "start-custom-race",
            startSong: {
                id: "lastfm:Custom:RestartStart",
                title: "Restart Start",
                artist: "Custom",
                albumArt: "",
            },
            targetSong: {
                id: "lastfm:Custom:RestartTarget",
                title: "Restart Target",
                artist: "Custom",
                albumArt: "",
            },
        });
        const songId = custom.session!.gameState.currentSongId;
        const started = gameBoardReducer(custom, {
            type: "expansion-started",
            raceVersion: custom.raceVersion,
            songId,
        });
        const expanded = gameBoardReducer(started, {
            type: "expansion-succeeded",
            raceVersion: started.raceVersion,
            songId,
            songs: [{
                id: "lastfm:Custom:Remembered",
                title: "Remembered",
                artist: "Custom",
                albumArt: "",
            }],
        });
        const restarted = gameBoardReducer(expanded, { type: "restart-race" });

        expect(restarted.session?.gameState.currentSongId).toBe(songId);
        expect(restarted.session?.gameState.moves).toBe(0);
        expect(restarted.session?.exploration.graph.nodes.has(
            "lastfm:Custom:Remembered",
        )).toBe(true);
        expect(restarted.session?.exploration.expandedSongIds.has(songId)).toBe(true);

        const newCustom = gameBoardReducer(restarted, {
            type: "leave-custom-race",
        });
        expect(newCustom.raceKind).toBe("random");
        expect(newCustom.graph).toBe(random.graph);
        expect(newCustom.session?.race).toEqual(random.session?.race);
        expect(newCustom.session).toBeNull();
    });

    it("ignores an expansion response after a custom race is abandoned", () => {
        const random = createInitialLiveCustomState();
        const custom = gameBoardReducer(random, {
            type: "start-custom-race",
            startSong: {
                id: "lastfm:Custom:StaleStart",
                title: "Stale Start",
                artist: "Custom",
                albumArt: "",
            },
            targetSong: {
                id: "lastfm:Custom:StaleTarget",
                title: "Stale Target",
                artist: "Custom",
                albumArt: "",
            },
        });
        const songId = custom.session!.gameState.currentSongId;
        const loading = gameBoardReducer(custom, {
            type: "expansion-started",
            raceVersion: custom.raceVersion,
            songId,
        });
        const left = gameBoardReducer(loading, { type: "leave-custom-race" });
        const stale = gameBoardReducer(left, {
            type: "expansion-succeeded",
            raceVersion: custom.raceVersion,
            songId,
            songs: [{
                id: "lastfm:Custom:Stale",
                title: "Stale",
                artist: "Custom",
                albumArt: "",
            }],
        });

        expect(stale).toBe(left);
        expect(stale.raceKind).toBe("random");
        expect(stale.graph).toBeNull();
    });

    it("ignores stale custom responses after Restart and after selecting a new pair", () => {
        const firstCustom = gameBoardReducer(createInitialLiveCustomState(), {
            type: "start-custom-race",
            startSong: {
                id: "lastfm:Custom:FirstStart",
                title: "First Start",
                artist: "Custom",
                albumArt: "",
            },
            targetSong: {
                id: "lastfm:Custom:FirstTarget",
                title: "First Target",
                artist: "Custom",
                albumArt: "",
            },
        });
        const firstSongId = firstCustom.session!.gameState.currentSongId;
        const loading = gameBoardReducer(firstCustom, {
            type: "expansion-started",
            raceVersion: firstCustom.raceVersion,
            songId: firstSongId,
        });
        const restarted = gameBoardReducer(loading, { type: "restart-race" });
        const staleAfterRestart = gameBoardReducer(restarted, {
            type: "expansion-succeeded",
            raceVersion: firstCustom.raceVersion,
            songId: firstSongId,
            songs: [{
                id: "lastfm:Custom:AfterRestart",
                title: "After Restart",
                artist: "Custom",
                albumArt: "",
            }],
        });
        expect(staleAfterRestart).toBe(restarted);

        const secondCustom = gameBoardReducer(restarted, {
            type: "start-custom-race",
            startSong: {
                id: "lastfm:Custom:SecondStart",
                title: "Second Start",
                artist: "Custom",
                albumArt: "",
            },
            targetSong: {
                id: "lastfm:Custom:SecondTarget",
                title: "Second Target",
                artist: "Custom",
                albumArt: "",
            },
        });
        const staleAfterNewSelection = gameBoardReducer(secondCustom, {
            type: "expansion-succeeded",
            raceVersion: firstCustom.raceVersion,
            songId: firstSongId,
            songs: [{
                id: "lastfm:Custom:AfterNewSelection",
                title: "After New Selection",
                artist: "Custom",
                albumArt: "",
            }],
        });
        expect(staleAfterNewSelection).toBe(secondCustom);
        expect(staleAfterNewSelection.graph?.nodes.has(
            "lastfm:Custom:AfterNewSelection",
        )).toBe(false);
    });

    it("backs up several moves, including from a dead end, without reverse edges", () => {
        const loading = gameBoardReducer(createInitialGameBoardState(), {
            type: "change-mode",
            mode: "lastfm",
        });
        const graph: SongGraph = {
            nodes: new Map(
                ["a", "b", "c", "d", "e"].map((id) => [
                    id,
                    { id, title: id, artist: "Band", albumArt: "" },
                ]),
            ),
            edges: new Map([
                ["a", ["b"]],
                ["b", ["c"]],
                ["c", ["d", "e"]],
                ["d", []],
                ["e", []],
            ]),
        };
        const loaded = gameBoardReducer(loading, {
            type: "graph-loaded",
            requestId: loading.requestId,
            graph,
            expandedSongIds: ["a", "b", "c", "d", "e"],
        });
        let current: ReturnType<typeof gameBoardReducer> = {
            ...loaded,
            session: {
                ...loaded.session!,
                race: { startSongId: "a", targetSongId: "d", optimalMoves: 3 },
                gameState: createGame(graph, "a", "d"),
                exploration: initializeExplorationGraph(
                    graph,
                    "a",
                    "d",
                    ["a", "b", "c", "d", "e"],
                ),
            },
        };

        current = gameBoardReducer(current, { type: "move", songId: "b" });
        current = gameBoardReducer(current, { type: "move", songId: "c" });
        current = gameBoardReducer(current, { type: "move", songId: "e" });
        expect(current.session?.gameState.moves).toBe(3);
        expect(getAvailableMoves(graph, current.session!.gameState)).toEqual([]);
        current = gameBoardReducer(current, { type: "back" });
        expect(current.session?.gameState.currentSongId).toBe("c");
        expect(current.session?.gameState.moves).toBe(2);
        expect(graph.edges.get("e")).not.toContain("c");
        expect(current.session?.gameState.status).toBe("playing");

        current = gameBoardReducer(current, { type: "back" });
        current = gameBoardReducer(current, { type: "back" });
        expect(current.session?.gameState.currentSongId).toBe("a");
        expect(current.session?.gameState.visitedSongs).toEqual(["a"]);
        expect(current.session?.gameState.moves).toBe(0);
    });

    it("disables backtracking at the start and preserves exploration on Back and Restart", () => {
        const initial = gameBoardReducer(createInitialLiveCustomState(), {
            type: "start-custom-race",
            startSong: {
                id: "lastfm:Back:Start",
                title: "Start",
                artist: "Back",
                albumArt: "",
            },
            targetSong: {
                id: "lastfm:Back:Target",
                title: "Target",
                artist: "Back",
                albumArt: "",
            },
        });
        const startId = initial.session!.gameState.currentSongId;
        const atStart = gameBoardReducer(initial, { type: "back" });
        expect(atStart).toBe(initial);

        const expandedStart = gameBoardReducer(
            gameBoardReducer(initial, {
                type: "expansion-started",
                raceVersion: initial.raceVersion,
                songId: startId,
            }),
            {
                type: "expansion-succeeded",
                raceVersion: initial.raceVersion,
                songId: startId,
                songs: [{
                    id: "lastfm:Back:Next",
                    title: "Next",
                    artist: "Back",
                    albumArt: "",
                }],
            },
        );
        const moved = gameBoardReducer(expandedStart, {
            type: "move",
            songId: "lastfm:Back:Next",
        });
        const backed = gameBoardReducer(moved, { type: "back" });

        expect(backed.session?.exploration.expandedSongIds.has(startId)).toBe(true);
        expect(backed.session?.exploration.graph.nodes.has("lastfm:Back:Next")).toBe(true);
        expect(backed.session?.exploration.originalShortestPathDistance).toBeNull();
        const restarted = gameBoardReducer(moved, { type: "restart-race" });
        expect(restarted.session?.gameState.currentSongId).toBe(startId);
        expect(restarted.session?.gameState.moves).toBe(0);
        expect(restarted.session?.exploration.graph.nodes.has("lastfm:Back:Next")).toBe(true);
    });

    it("does not fetch an expanded song again after backtracking", async () => {
        const custom = gameBoardReducer(createInitialLiveCustomState(), {
            type: "start-custom-race",
            startSong: {
                id: "lastfm:Back:ExpandedStart",
                title: "Start",
                artist: "Back",
                albumArt: "",
            },
            targetSong: {
                id: "lastfm:Back:ExpandedTarget",
                title: "Target",
                artist: "Back",
                albumArt: "",
            },
        });
        const startId = custom.session!.gameState.currentSongId;
        const expanded = gameBoardReducer(
            gameBoardReducer(custom, {
                type: "expansion-started",
                raceVersion: custom.raceVersion,
                songId: startId,
            }),
            {
                type: "expansion-succeeded",
                raceVersion: custom.raceVersion,
                songId: startId,
                songs: [{
                    id: "lastfm:Back:ExpandedNext",
                    title: "Next",
                    artist: "Back",
                    albumArt: "",
                }],
            },
        );
        const moved = gameBoardReducer(expanded, {
            type: "move",
            songId: "lastfm:Back:ExpandedNext",
        });
        const backed = gameBoardReducer(moved, { type: "back" });
        const fetcher = vi.fn<typeof fetch>();

        expect(
            triggerCurrentSongExpansion(backed, () => {}, fetcher),
        ).toBe(false);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("ignores a pending request when backtracking changes the active song", async () => {
        let resolveResponse: ((response: Response) => void) | undefined;
        const pendingResponse = new Promise<Response>((resolve) => {
            resolveResponse = resolve;
        });
        const fetcher = vi.fn<typeof fetch>().mockReturnValue(pendingResponse);
        const initial = gameBoardReducer(createInitialLiveCustomState(), {
            type: "start-custom-race",
            startSong: {
                id: "lastfm:Back:PendingStart",
                title: "Start",
                artist: "Back",
                albumArt: "",
            },
            targetSong: {
                id: "lastfm:Back:PendingTarget",
                title: "Target",
                artist: "Back",
                albumArt: "",
            },
        });
        const startId = initial.session!.gameState.currentSongId;
        const seeded = gameBoardReducer(
            gameBoardReducer(initial, {
                type: "expansion-started",
                raceVersion: initial.raceVersion,
                songId: startId,
            }),
            {
                type: "expansion-succeeded",
                raceVersion: initial.raceVersion,
                songId: startId,
                songs: [{
                    id: "lastfm:Back:PendingNext",
                    title: "Next",
                    artist: "Back",
                    albumArt: "",
                }],
            },
        );
        const moved = gameBoardReducer(seeded, {
            type: "move",
            songId: "lastfm:Back:PendingNext",
        });
        let current = moved;
        triggerCurrentSongExpansion(
            current,
            (action) => {
                current = gameBoardReducer(current, action);
            },
            fetcher,
        );
        expect(current.expansionStatus).toBe("loading");
        expect(fetcher).toHaveBeenCalledTimes(1);

        current = gameBoardReducer(current, { type: "back" });
        expect(current.session?.gameState.currentSongId).toBe(startId);
        expect(current.expansionStatus).toBe("idle");
        const stateAfterBack = current;

        resolveResponse?.(
            new Response(
                JSON.stringify({
                    songs: [{
                        id: "lastfm:Back:StaleNext",
                        title: "Stale",
                        artist: "Back",
                        albumArt: "",
                    }],
                }),
                { status: 200 },
            ),
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(current).toBe(stateAfterBack);
        expect(current.session?.gameState.currentSongId).toBe(startId);
        expect(current.session?.exploration.graph.nodes.has(
            "lastfm:Back:StaleNext",
        )).toBe(false);
    });

    it("keeps Demo songs marked expanded so they never need network expansion", () => {
        const state = createInitialGameBoardState();
        const currentSongId = state.session!.gameState.currentSongId;
        const fetcher = vi.fn<typeof fetch>();

        expect(state.mode).toBe("demo");
        expect(songRequiresExpansion(state.session!.exploration, currentSongId))
            .toBe(false);
        expect(state.session!.exploration.expandedSongIds.size).toBe(
            state.graph?.nodes.size,
        );
        expect(
            triggerCurrentSongExpansion(state, vi.fn(), fetcher),
        ).toBe(false);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("keeps the current race and reports when no alternative pair exists", () => {
        const graph: SongGraph = {
            nodes: new Map(
                serializedGraph.songs.slice(0, 3).map((song) => [song.id, { ...song }]),
            ),
            edges: new Map([
                ["a", ["b"]],
                ["b", ["c"]],
                ["c", []],
            ]),
        };
        const onlyRace = gameBoardReducer(
            {
                mode: "demo",
                demoGraphSelection: "indie-alternative",
                demoGraphId: "indie-alternative",
                raceKind: "random",
                pausedRandomState: null,
                difficulty: "easy",
                status: "ready",
                graph,
                expandedSongIds: [],
                session: {
                    race: {
                        startSongId: "a",
                        targetSongId: "c",
                        optimalMoves: 2,
                    },
                    gameState: {
                        startSongId: "a",
                        targetSongId: "c",
                        currentSongId: "a",
                        visitedSongs: ["a"],
                        moves: 0,
                        status: "playing",
                    },
                    exploration: initializeExplorationGraph(graph, "a", "c"),
                },
                error: null,
                notice: null,
                expansionStatus: "idle",
                expansionSongId: null,
                expansionError: null,
                raceVersion: 0,
                requestId: 0,
            },
            { type: "new-race", random: () => 0 },
        );

        expect(onlyRace.session?.race).toEqual({
            startSongId: "a",
            targetSongId: "c",
            optimalMoves: 2,
        });
        expect(onlyRace.notice).toContain("No other race is available");
    });
});

function fetchGraphFixture(): SongGraph {
    return {
        nodes: new Map(
            serializedGraph.songs.map((song) => [song.id, { ...song }]),
        ),
        edges: new Map(
            serializedGraph.edges.map((edge) => [
                edge.songId,
                [...edge.recommendations],
            ]),
        ),
    };
}
