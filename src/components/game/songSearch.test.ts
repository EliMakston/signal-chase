import { afterEach, describe, expect, it, vi } from "vitest";
import {
    createSongSearchController,
    fetchSongSearchResults,
} from "./songSearch";

afterEach(() => {
    vi.useRealTimers();
});

function song(id: string, title = "Song") {
    return { id, title, artist: "Artist", albumArt: "" };
}

describe("song search", () => {
    it("uses the search API and validates and deduplicates results", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    songs: [song("lastfm:Artist:Song"), song("lastfm:Artist:Song")],
                }),
                { status: 200 },
            ),
        );

        await expect(
            fetchSongSearchResults("  song name  ", fetcher),
        ).resolves.toEqual([song("lastfm:Artist:Song")]);
        const [requestUrl] = fetcher.mock.calls[0];
        const url = new URL(String(requestUrl), "https://game.test");
        expect(url.pathname).toBe("/api/music/search");
        expect(url.searchParams.get("query")).toBe("song name");
    });

    it("rejects malformed or non-canonical search results", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    songs: [song("lastfm:Artist:%E0%A4%A")],
                }),
                { status: 200 },
            ),
        );

        await expect(fetchSongSearchResults("query", fetcher)).rejects.toThrow(
            "must contain valid songs",
        );
    });

    it("reports empty results and API failures as distinct states", async () => {
        vi.useFakeTimers();
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ songs: [] }), { status: 200 }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ error: "Provider unavailable" }), {
                    status: 502,
                }),
            );
        const controller = createSongSearchController(fetcher, 50);
        const emptyStates: string[] = [];
        const errorStates: string[] = [];

        controller.search("no match", (state) => emptyStates.push(state.status));
        await vi.advanceTimersByTimeAsync(50);
        await vi.waitFor(() => expect(emptyStates).toContain("empty"));

        controller.search("failure", (state) => errorStates.push(state.status));
        await vi.advanceTimersByTimeAsync(50);
        await vi.waitFor(() => expect(errorStates).toContain("error"));

        expect(emptyStates).toEqual(["loading", "empty"]);
        expect(errorStates).toEqual(["loading", "error"]);
        expect(fetcher.mock.calls).toHaveLength(2);
    });

    it("hides upstream error details and allows the same query to be retried", async () => {
        vi.useFakeTimers();
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ error: "provider-token-secret" }), {
                    status: 502,
                }),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ songs: [song("lastfm:Artist:Retry")] }),
                    { status: 200 },
                ),
            );
        const controller = createSongSearchController(fetcher, 10);
        const firstMessages: string[] = [];
        controller.search("same query", (state) => {
            if (state.error) firstMessages.push(state.error);
        });
        await vi.advanceTimersByTimeAsync(10);
        await vi.waitFor(() => expect(firstMessages).toHaveLength(1));
        expect(firstMessages[0]).toContain("temporarily unavailable");
        expect(firstMessages[0]).not.toContain("provider-token-secret");

        const retryStates: string[] = [];
        controller.search("same query", (state) => retryStates.push(state.status));
        await vi.advanceTimersByTimeAsync(10);
        await vi.waitFor(() => expect(retryStates).toContain("results"));
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("debounces changed queries and issues only the latest request", async () => {
        vi.useFakeTimers();
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ songs: [song("lastfm:Artist:Latest")] }), {
                status: 200,
            }),
        );
        const controller = createSongSearchController(fetcher, 250);
        const updates: string[] = [];

        controller.search("old", (state) => updates.push(state.status));
        controller.search("latest", (state) => updates.push(state.status));
        await vi.advanceTimersByTimeAsync(249);
        expect(fetcher).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(updates).toContain("results"));

        const [requestUrl] = fetcher.mock.calls[0];
        expect(new URL(String(requestUrl), "https://game.test").searchParams.get("query"))
            .toBe("latest");
        expect(updates).toEqual(["loading", "loading", "results"]);
    });

    it("does not allow a slower stale response to replace newer results", async () => {
        vi.useFakeTimers();
        let releaseOldResponse: ((response: Response) => void) | undefined;
        const oldResponse = new Promise<Response>((resolve) => {
            releaseOldResponse = resolve;
        });
        const fetcher = vi
            .fn<typeof fetch>()
            .mockImplementationOnce(() => oldResponse)
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ songs: [song("lastfm:Artist:New")] }), {
                    status: 200,
                }),
            );
        const controller = createSongSearchController(fetcher, 100);
        const oldUpdates: string[] = [];
        const newUpdates: string[] = [];

        controller.search("old", (state) => oldUpdates.push(state.songs[0]?.id ?? state.status));
        await vi.advanceTimersByTimeAsync(100);
        expect(fetcher).toHaveBeenCalledTimes(1);

        controller.search("new", (state) => newUpdates.push(state.songs[0]?.id ?? state.status));
        await vi.advanceTimersByTimeAsync(100);
        await vi.waitFor(() => expect(newUpdates).toContain("lastfm:Artist:New"));
        releaseOldResponse?.(
            new Response(
                JSON.stringify({ songs: [song("lastfm:Artist:Old")] }),
                { status: 200 },
            ),
        );
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
        await Promise.resolve();

        expect(oldUpdates).not.toContain("lastfm:Artist:Old");
        expect(newUpdates).toContain("lastfm:Artist:New");
    });

    it("cancels a search on cleanup and permits a fresh request for the same query", async () => {
        vi.useFakeTimers();
        let releaseOldResponse: ((response: Response) => void) | undefined;
        const oldResponse = new Promise<Response>((resolve) => {
            releaseOldResponse = resolve;
        });
        const fetcher = vi
            .fn<typeof fetch>()
            .mockImplementationOnce((_input, init) => {
                expect(init?.signal?.aborted).toBe(false);
                return oldResponse;
            })
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ songs: [song("lastfm:Artist:Fresh")] }), {
                    status: 200,
                }),
            );
        const controller = createSongSearchController(fetcher, 20);
        const staleUpdates: string[] = [];
        const cancel = controller.search("same query", (state) =>
            staleUpdates.push(state.songs[0]?.id ?? state.status),
        );
        await vi.advanceTimersByTimeAsync(20);
        cancel();
        releaseOldResponse?.(
            new Response(
                JSON.stringify({ songs: [song("lastfm:Artist:Stale")] }),
                { status: 200 },
            ),
        );
        await Promise.resolve();
        expect(staleUpdates).not.toContain("lastfm:Artist:Stale");

        const freshUpdates: string[] = [];
        controller.search("same query", (state) =>
            freshUpdates.push(state.songs[0]?.id ?? state.status),
        );
        await vi.advanceTimersByTimeAsync(20);
        await vi.waitFor(() =>
            expect(freshUpdates).toContain("lastfm:Artist:Fresh"),
        );
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
});
