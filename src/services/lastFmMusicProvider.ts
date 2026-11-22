import type { Song } from "../game/types";
import type { MusicProvider } from "./musicProvider";

const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";
const SONG_ID_PREFIX = "lastfm:";

type LastFmErrorKind =
    | "configuration"
    | "http"
    | "api"
    | "malformed"
    | "network"
    | "invalid_song_id";

type LastFmErrorStage =
    | "input_validation"
    | "configuration"
    | "fetch"
    | "upstream_http"
    | "response_json"
    | "response_validation"
    | "lastfm_api";

interface LastFmErrorDetails {
    stage?: LastFmErrorStage;
    upstreamStatus?: number;
    lastFmErrorCode?: number | string;
    lastFmErrorMessage?: string;
    upstreamErrorType?: string;
}

export class LastFmProviderError extends Error {
    constructor(
        readonly kind: LastFmErrorKind,
        message: string,
        readonly details: LastFmErrorDetails = {},
    ) {
        super(message);
        this.name = "LastFmProviderError";
    }
}

type LastFmRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LastFmRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldText(value: unknown): string | null {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }

    if (isRecord(value) && typeof value.name === "string" && value.name.trim()) {
        return value.name.trim();
    }

    return null;
}

function encodeSongId(artist: string, title: string): string {
    return `${SONG_ID_PREFIX}${encodeURIComponent(artist)}:${encodeURIComponent(title)}`;
}

function decodeSongId(songId: string): { artist: string; title: string } {
    if (!songId.startsWith(SONG_ID_PREFIX)) {
        throw new LastFmProviderError("invalid_song_id", "Invalid Last.fm song ID.", {
            stage: "input_validation",
        });
    }

    const encodedSong = songId.slice(SONG_ID_PREFIX.length);
    const separatorIndex = encodedSong.indexOf(":");
    if (separatorIndex < 0) {
        throw new LastFmProviderError("invalid_song_id", "Invalid Last.fm song ID.", {
            stage: "input_validation",
        });
    }

    try {
        const artist = decodeURIComponent(encodedSong.slice(0, separatorIndex));
        const title = decodeURIComponent(encodedSong.slice(separatorIndex + 1));
        if (!artist.trim() || !title.trim()) {
            throw new Error("Missing artist or title");
        }
        return { artist, title };
    } catch {
        throw new LastFmProviderError("invalid_song_id", "Invalid Last.fm song ID.", {
            stage: "input_validation",
        });
    }
}

export function isValidLastFmSongId(songId: string): boolean {
    try {
        decodeSongId(songId);
        return true;
    } catch {
        return false;
    }
}

function albumArt(track: LastFmRecord): string {
    if (!Array.isArray(track.image)) {
        return "";
    }

    const images = track.image.filter(isRecord);
    const preferred =
        images.find((image) => image.size === "extralarge") ??
        images.find((image) => image.size === "large") ??
        images.find((image) => image.size === "medium") ??
        images[images.length - 1];
    const url = preferred?.["#text"];
    return typeof url === "string" ? url : "";
}

function normalizeTrack(track: unknown): Song | null {
    if (!isRecord(track)) {
        return null;
    }

    const title = fieldText(track.name) ?? fieldText(track.title);
    const artist = fieldText(track.artist);
    if (!title || !artist) {
        return null;
    }

    return {
        id: encodeSongId(artist, title),
        title,
        artist,
        albumArt: albumArt(track),
    };
}

function listFromResponse(value: unknown, key: string): unknown[] {
    if (value === undefined || value === null || value === "") {
        return [];
    }
    if (Array.isArray(value)) {
        return value;
    }
    if (isRecord(value)) {
        return [value];
    }
    throw new LastFmProviderError(
        "malformed",
        `Last.fm returned malformed ${key} data.`,
        { stage: "response_validation" },
    );
}

function errorDetails(
    payload: unknown,
    apiKey: string | undefined,
    stage: LastFmErrorStage,
    upstreamStatus?: number,
): LastFmErrorDetails {
    const details: LastFmErrorDetails = { stage };
    if (upstreamStatus !== undefined) {
        details.upstreamStatus = upstreamStatus;
    }

    if (!isRecord(payload)) {
        return details;
    }

    const errorCode = payload.error;
    if (typeof errorCode === "number" || typeof errorCode === "string") {
        details.lastFmErrorCode = errorCode;
    }

    if (typeof payload.message === "string") {
        const secrets = apiKey
            ? [apiKey, encodeURIComponent(apiKey)]
            : [];
        let safeMessage = payload.message.replace(/https?:\/\/\S+/gi, "[redacted-url]");
        for (const secret of secrets) {
            safeMessage = safeMessage.replaceAll(secret, "[redacted]");
        }
        details.lastFmErrorMessage = safeMessage.slice(0, 500);
    }

    return details;
}

export class LastFmMusicProvider implements MusicProvider {
    constructor(
        private readonly apiKey: string | undefined,
        private readonly fetcher: typeof fetch = fetch,
    ) {}

    async getSong(songId: string): Promise<Song | null> {
        const { artist, title } = decodeSongId(songId);
        const response = await this.request("track.getInfo", { artist, track: title });

        if (!("track" in response)) {
            return null;
        }
        if (!isRecord(response.track)) {
            throw new LastFmProviderError(
                "malformed",
                "Last.fm returned malformed track information.",
                { stage: "response_validation" },
            );
        }

        return normalizeTrack(response.track);
    }

    async getSimilarSongs(songId: string): Promise<Song[]> {
        const { artist, title } = decodeSongId(songId);
        const response = await this.request("track.getsimilar", {
            artist,
            track: title,
        });

        if (!isRecord(response.similartracks)) {
            throw new LastFmProviderError(
                "malformed",
                "Last.fm returned malformed similar-track data.",
                { stage: "response_validation" },
            );
        }

        return listFromResponse(response.similartracks.track, "similar-track")
            .map(normalizeTrack)
            .filter((song): song is Song => song !== null);
    }

    async searchSongs(query: string): Promise<Song[]> {
        const track = query.trim();
        if (!track) {
            return [];
        }

        const response = await this.request("track.search", { track });
        if (!isRecord(response.results) || !isRecord(response.results.trackmatches)) {
            throw new LastFmProviderError(
                "malformed",
                "Last.fm returned malformed search results.",
                { stage: "response_validation" },
            );
        }

        return listFromResponse(
            response.results.trackmatches.track,
            "search-result",
        )
            .map(normalizeTrack)
            .filter((song): song is Song => song !== null);
    }

    private async request(
        method: string,
        params: Record<string, string>,
    ): Promise<LastFmRecord> {
        if (!this.apiKey) {
            throw new LastFmProviderError(
                "configuration",
                "Last.fm API key is not configured.",
                { stage: "configuration" },
            );
        }

        const searchParams = new URLSearchParams({
            method,
            api_key: this.apiKey,
            format: "json",
            ...params,
        });

        let response: Response;
        try {
            response = await this.fetcher.call(
                globalThis,
                `${LASTFM_API_URL}?${searchParams}`,
            );
        } catch (error) {
            throw new LastFmProviderError(
                "network",
                "Last.fm request failed.",
                {
                    stage: "fetch",
                    upstreamErrorType:
                        error instanceof Error ? error.name : typeof error,
                },
            );
        }

        let payload: unknown;
        try {
            payload = await response.json();
        } catch {
            if (!response.ok) {
                throw new LastFmProviderError(
                    "http",
                    `Last.fm request failed with status ${response.status}.`,
                    { stage: "response_json", upstreamStatus: response.status },
                );
            }
            throw new LastFmProviderError(
                "malformed",
                "Last.fm returned invalid JSON.",
                { stage: "response_json", upstreamStatus: response.status },
            );
        }
        if (!response.ok) {
            throw new LastFmProviderError(
                "http",
                `Last.fm request failed with status ${response.status}.`,
                errorDetails(payload, this.apiKey, "upstream_http", response.status),
            );
        }
        if (!isRecord(payload)) {
            throw new LastFmProviderError(
                "malformed",
                "Last.fm returned an invalid response.",
                { stage: "response_validation", upstreamStatus: response.status },
            );
        }
        if ("error" in payload) {
            throw new LastFmProviderError(
                "api",
                "Last.fm reported an API error.",
                errorDetails(payload, this.apiKey, "lastfm_api", response.status),
            );
        }

        return payload;
    }
}
