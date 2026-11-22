import { describe, expect, it, vi } from "vitest";
import {
    LastFmMusicProvider,
    LastFmProviderError,
} from "./lastFmMusicProvider";

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function mockFetch(payload: unknown, status = 200) {
    return vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload, status));
}

describe("LastFmMusicProvider", () => {
    it("normalizes track information and decodes stable artist/title IDs", async () => {
        const fetcher = mockFetch({
            track: {
                name: "Signal: Noise",
                artist: { name: "A & B" },
                image: [
                    { size: "small", "#text": "small.jpg" },
                    { size: "extralarge", "#text": "large.jpg" },
                ],
            },
        });
        const provider = new LastFmMusicProvider("test-key", fetcher);

        await expect(
            provider.getSong("lastfm:A%20%26%20B:Signal%3A%20Noise"),
        ).resolves.toEqual({
            id: "lastfm:A%20%26%20B:Signal%3A%20Noise",
            title: "Signal: Noise",
            artist: "A & B",
            albumArt: "large.jpg",
        });

        const [requestUrl] = fetcher.mock.calls[0];
        const url = new URL(String(requestUrl));
        expect(url.searchParams.get("method")).toBe("track.getInfo");
        expect(url.searchParams.get("artist")).toBe("A & B");
        expect(url.searchParams.get("track")).toBe("Signal: Noise");
        expect(url.searchParams.get("api_key")).toBe("test-key");
        expect(url.searchParams.get("format")).toBe("json");
    });

    it("returns null when track information is empty", async () => {
        const provider = new LastFmMusicProvider(
            "test-key",
            mockFetch({}),
        );

        await expect(
            provider.getSong("lastfm:Artist:Unknown"),
        ).resolves.toBeNull();
    });

    it("returns null when track metadata cannot be normalized", async () => {
        const provider = new LastFmMusicProvider(
            "test-key",
            mockFetch({ track: { name: "Track without artist" } }),
        );

        await expect(
            provider.getSong("lastfm:Artist:Track"),
        ).resolves.toBeNull();
    });

    it("normalizes similar tracks and skips entries missing required metadata", async () => {
        const fetcher = mockFetch({
            similartracks: {
                track: [
                    { name: "First", artist: "One" },
                    { name: "Missing artist" },
                    { name: "Second", artist: { name: "Two" } },
                ],
            },
        });
        const provider = new LastFmMusicProvider(
            "test-key",
            fetcher,
        );

        await expect(
            provider.getSimilarSongs("lastfm:Source:Track"),
        ).resolves.toEqual([
            {
                id: "lastfm:One:First",
                title: "First",
                artist: "One",
                albumArt: "",
            },
            {
                id: "lastfm:Two:Second",
                title: "Second",
                artist: "Two",
                albumArt: "",
            },
        ]);
        const [requestUrl] = fetcher.mock.calls[0];
        expect(new URL(String(requestUrl)).searchParams.get("method")).toBe(
            "track.getsimilar",
        );
    });

    it("invokes Worker fetch with the globalThis receiver", async () => {
        let fetchReceiver: unknown;
        const fetcher = vi.fn<typeof fetch>(function (this: unknown) {
            fetchReceiver = this;
            return Promise.resolve(
                jsonResponse({ similartracks: { track: [] } }),
            );
        });
        const provider = new LastFmMusicProvider("test-key", fetcher);

        await expect(
            provider.getSimilarSongs("lastfm:Source:Track"),
        ).resolves.toEqual([]);
        expect(fetchReceiver).toBe(globalThis);
    });

    it("handles a single similar-track object and empty recommendation lists", async () => {
        const singleTrack = new LastFmMusicProvider(
            "test-key",
            mockFetch({
                similartracks: {
                    track: { name: "Related", artist: "Artist" },
                },
            }),
        );
        const noTracks = new LastFmMusicProvider(
            "test-key",
            mockFetch({ similartracks: { track: [] } }),
        );

        await expect(
            singleTrack.getSimilarSongs("lastfm:Source:Track"),
        ).resolves.toHaveLength(1);
        await expect(
            noTracks.getSimilarSongs("lastfm:Source:Track"),
        ).resolves.toEqual([]);
    });

    it("normalizes search results and returns an empty list for a blank query", async () => {
        const fetcher = mockFetch({
            results: {
                trackmatches: {
                    track: [
                        { name: "Found", artist: "Singer" },
                        { name: "Incomplete" },
                    ],
                },
            },
        });
        const provider = new LastFmMusicProvider("test-key", fetcher);

        await expect(provider.searchSongs("  ")).resolves.toEqual([]);
        expect(fetcher).not.toHaveBeenCalled();
        await expect(provider.searchSongs("  found  ")).resolves.toEqual([
            {
                id: "lastfm:Singer:Found",
                title: "Found",
                artist: "Singer",
                albumArt: "",
            },
        ]);

        const [requestUrl] = fetcher.mock.calls[0];
        expect(new URL(String(requestUrl)).searchParams.get("method")).toBe(
            "track.search",
        );
        expect(new URL(String(requestUrl)).searchParams.get("track")).toBe(
            "found",
        );
    });

    it("rejects malformed or non-Last.fm song IDs before making a request", async () => {
        const fetcher = mockFetch({});
        const provider = new LastFmMusicProvider("test-key", fetcher);

        await expect(provider.getSong("song-1")).rejects.toMatchObject({
            kind: "invalid_song_id",
        });
        await expect(provider.getSimilarSongs("lastfm::Track")).rejects.toMatchObject({
            kind: "invalid_song_id",
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("reports missing server configuration without making a request", async () => {
        const fetcher = mockFetch({});
        const provider = new LastFmMusicProvider(undefined, fetcher);

        await expect(
            provider.getSimilarSongs("lastfm:Artist:Track"),
        ).rejects.toMatchObject({ kind: "configuration" });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("handles HTTP, Last.fm API, and malformed JSON errors", async () => {
        const httpFailure = new LastFmMusicProvider(
            "test-key",
            mockFetch({}, 503),
        );
        const apiFailure = new LastFmMusicProvider(
            "test-key",
            mockFetch({ error: 6, message: "Track not found" }),
        );
        const malformedJson = new LastFmMusicProvider(
            "test-key",
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response("not-json", {
                    headers: { "Content-Type": "application/json" },
                }),
            ),
        );

        await expect(
            httpFailure.getSong("lastfm:Artist:Track"),
        ).rejects.toMatchObject({ kind: "http" });
        await expect(
            apiFailure.getSong("lastfm:Artist:Track"),
        ).rejects.toMatchObject({ kind: "api" });
        await expect(
            malformedJson.getSong("lastfm:Artist:Track"),
        ).rejects.toMatchObject({ kind: "malformed" });
    });

    it("preserves safe Last.fm API diagnostics without retaining the API key", async () => {
        const provider = new LastFmMusicProvider(
            "secret key",
            mockFetch({
                error: 6,
                message: "Track not found for supplied credentials: secret key",
            }),
        );

        await expect(
            provider.getSimilarSongs("lastfm:Artist:Track"),
        ).rejects.toMatchObject({
            kind: "api",
            details: {
                upstreamStatus: 200,
                lastFmErrorCode: 6,
                lastFmErrorMessage:
                    "Track not found for supplied credentials: [redacted]",
            },
        });
    });

    it("uses Last.fm's documented lowercase similar method and identifies API errors", async () => {
        const fetcher = mockFetch({
            error: 3,
            message: "Invalid Method - No method with that name in this package",
        });
        const provider = new LastFmMusicProvider("test-key", fetcher);

        await expect(
            provider.getSimilarSongs("lastfm:Artist:Track"),
        ).rejects.toMatchObject({
            kind: "api",
            details: {
                stage: "lastfm_api",
                lastFmErrorCode: 3,
            },
        });
        const [requestUrl] = fetcher.mock.calls[0];
        expect(new URL(String(requestUrl)).searchParams.get("method")).toBe(
            "track.getsimilar",
        );
    });

    it("preserves Last.fm diagnostics on non-success HTTP responses", async () => {
        const provider = new LastFmMusicProvider(
            "test-key",
            mockFetch({ error: 29, message: "Rate limit exceeded" }, 429),
        );

        await expect(
            provider.getSimilarSongs("lastfm:Artist:Track"),
        ).rejects.toMatchObject({
            kind: "http",
            details: {
                upstreamStatus: 429,
                lastFmErrorCode: 29,
                lastFmErrorMessage: "Rate limit exceeded",
            },
        });
    });

    it("records the upstream error type for network failures", async () => {
        const provider = new LastFmMusicProvider(
            "test-key",
            vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")),
        );

        await expect(
            provider.getSong("lastfm:Artist:Track"),
        ).rejects.toMatchObject({
            kind: "network",
            details: { upstreamErrorType: "TypeError" },
        });
    });

    it("reports malformed response structures explicitly", async () => {
        const provider = new LastFmMusicProvider(
            "test-key",
            mockFetch({ similartracks: "invalid" }),
        );

        await expect(
            provider.getSimilarSongs("lastfm:Artist:Track"),
        ).rejects.toBeInstanceOf(LastFmProviderError);
        await expect(
            provider.getSimilarSongs("lastfm:Artist:Track"),
        ).rejects.toMatchObject({ kind: "malformed" });
    });

    it("does not include the API key in request failure messages", async () => {
        const provider = new LastFmMusicProvider(
            "private-test-key",
            vi.fn<typeof fetch>().mockRejectedValue(new Error("network error")),
        );

        await expect(
            provider.getSong("lastfm:Artist:Track"),
        ).rejects.toThrow("Last.fm request failed.");
        await expect(
            provider.getSong("lastfm:Artist:Track"),
        ).rejects.not.toThrow("private-test-key");
    });
});
