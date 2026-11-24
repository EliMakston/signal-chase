import type { Song } from "../game/types";
import { getSafeLastFmTrackUrl } from "../game/lastFmUrl";
import type { MusicProvider } from "./musicProvider";
import { LastFmResponseCache } from "./lastFmResponseCache";
import {
    lastFmRequestAccounting,
    LocalLastFmRequestTransport,
} from "./lastFmRequestTransport";
import type {
    LastFmMethod,
    LastFmRequestAccounting,
    LastFmRequestTransport,
} from "./lastFmRequestTransport";

const SONG_ID_PREFIX = "lastfm:";

type LastFmErrorKind =
    | "configuration"
    | "http"
    | "api"
    | "rate_limited"
    | "timeout"
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
    retryAfterSeconds?: number;
}

const LASTFM_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_AFTER_SECONDS = 60;
const lastFmResponseCache = new LastFmResponseCache();

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
    if (
        songId.length > 512 ||
        !songId.startsWith(SONG_ID_PREFIX)
    ) {
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
        if (
            !artist.trim() ||
            !title.trim() ||
            artist.length > 160 ||
            title.length > 160 ||
            /[\u0000-\u001f\u007f]/.test(artist) ||
            /[\u0000-\u001f\u007f]/.test(title)
        ) {
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

export function canonicalizeLastFmSongId(songId: string): string {
    const { artist, title } = decodeSongId(songId);
    return encodeSongId(artist, title);
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

    const lastFmUrl = getSafeLastFmTrackUrl(track.url);
    return {
        id: encodeSongId(artist, title),
        title,
        artist,
        albumArt: "",
        ...(lastFmUrl ? { lastFmUrl } : {}),
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
    retryAfterHeader?: string | null,
): LastFmErrorDetails {
    const details: LastFmErrorDetails = { stage };
    if (upstreamStatus !== undefined) {
        details.upstreamStatus = upstreamStatus;
    }

    if (isRecord(payload)) {
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
    }
    if (
        upstreamStatus === 429 ||
        details.lastFmErrorCode === 29 ||
        details.lastFmErrorCode === "29"
    ) {
        const retryAfter = Number(retryAfterHeader);
        details.retryAfterSeconds =
            Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 3600
                ? retryAfter
                : DEFAULT_RETRY_AFTER_SECONDS;
    }

    return details;
}

export class LastFmMusicProvider implements MusicProvider {
    private readonly transport: LastFmRequestTransport;
    private readonly accounting: LastFmRequestAccounting;
    private readonly cacheEnabled: boolean;

    constructor(
        private readonly apiKey: string | undefined,
        fetcher: typeof fetch = fetch,
        private readonly timeoutMs = LASTFM_REQUEST_TIMEOUT_MS,
        private readonly overallSignal?: AbortSignal,
        private readonly responseCache: LastFmResponseCache = lastFmResponseCache,
        options: {
            cacheEnabled?: boolean;
            transport?: LastFmRequestTransport;
            accounting?: LastFmRequestAccounting;
        } = {},
    ) {
        this.accounting = options.accounting ?? lastFmRequestAccounting;
        this.transport = options.transport ?? new LocalLastFmRequestTransport(fetcher, this.accounting);
        this.cacheEnabled = options.cacheEnabled === true;
    }

    async getSong(songId: string): Promise<Song | null> {
        this.accounting.recordProviderInvocation();
        const { artist, title } = decodeSongId(songId);
        return this.request("track.getInfo", { artist, track: title }, (response) => {
            if (!("track" in response)) return { value: null, cacheable: false };
            if (!isRecord(response.track)) {
                throw new LastFmProviderError(
                    "malformed",
                    "Last.fm returned malformed track information.",
                    { stage: "response_validation" },
                );
            }
            const song = normalizeTrack(response.track);
            return { value: song, cacheable: song !== null };
        });
    }

    async getSimilarSongs(songId: string): Promise<Song[]> {
        this.accounting.recordProviderInvocation();
        const { artist, title } = decodeSongId(songId);
        return this.request("track.getsimilar", {
            artist,
            track: title,
        }, (response) => {
            if (!isRecord(response.similartracks)) {
                throw new LastFmProviderError(
                    "malformed",
                    "Last.fm returned malformed similar-track data.",
                    { stage: "response_validation" },
                );
            }
            const songs = listFromResponse(response.similartracks.track, "similar-track")
                .map(normalizeTrack);
            return {
                value: songs.filter((song): song is Song => song !== null),
                cacheable: songs.every((song) => song !== null),
            };
        });
    }

    async searchSongs(query: string): Promise<Song[]> {
        this.accounting.recordProviderInvocation();
        const track = query.trim();
        if (!track) {
            return [];
        }

        return this.request("track.search", { track }, (response) => {
            if (!isRecord(response.results) || !isRecord(response.results.trackmatches)) {
                throw new LastFmProviderError(
                    "malformed",
                    "Last.fm returned malformed search results.",
                    { stage: "response_validation" },
                );
            }
            const songs = listFromResponse(response.results.trackmatches.track, "search-result")
                .map(normalizeTrack);
            return {
                value: songs.filter((song): song is Song => song !== null),
                cacheable: songs.every((song) => song !== null),
            };
        });
    }

    private async request<T>(
        method: LastFmMethod,
        params: Record<string, string>,
        validate: (response: LastFmRecord) => { value: T; cacheable: boolean },
    ): Promise<T> {
        if (!this.apiKey) {
            throw new LastFmProviderError(
                "configuration",
                "Last.fm API key is not configured.",
                { stage: "configuration" },
            );
        }

        const cacheKey = `${method}?${new URLSearchParams(
            Object.entries(params).sort(([left], [right]) =>
                left.localeCompare(right),
            ),
        )}`;
        if (this.cacheEnabled) {
            const cachedBody = this.responseCache.get(cacheKey);
            if (cachedBody !== undefined) {
                let cachedPayload: unknown;
                try {
                    cachedPayload = JSON.parse(cachedBody);
                } catch {
                    throw new LastFmProviderError("malformed", "Cached Last.fm response contains invalid JSON.", {
                        stage: "response_json",
                    });
                }
                if (!isRecord(cachedPayload) || "error" in cachedPayload) {
                    throw new LastFmProviderError("malformed", "Cached Last.fm response is invalid.", {
                        stage: "response_validation",
                    });
                }
                const result = validate(cachedPayload);
                if (!result.cacheable) {
                    throw new LastFmProviderError("malformed", "Cached Last.fm response is invalid.", {
                        stage: "response_validation",
                    });
                }
                this.accounting.recordCacheHit();
                return result.value;
            }
        }

        let response: Response;
        const requestTimeout = AbortSignal.timeout(this.timeoutMs);
        const signal = this.overallSignal
            ? AbortSignal.any([this.overallSignal, requestTimeout])
            : requestTimeout;
        try {
            response = await this.transport.dispatch({ method, params, apiKey: this.apiKey, signal });
        } catch (error) {
            if (
                signal.aborted ||
                (error instanceof DOMException && error.name === "TimeoutError")
            ) {
                throw new LastFmProviderError(
                    "timeout",
                    "Last.fm request timed out.",
                    {
                        stage: "fetch",
                        upstreamErrorType: "TimeoutError",
                    },
                );
            }
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

        let body: string;
        try {
            body = await response.text();
        } catch {
            if (signal.aborted) {
                throw new LastFmProviderError(
                    "timeout",
                    "Last.fm request timed out.",
                    {
                        stage: "response_json",
                        upstreamErrorType: "TimeoutError",
                    },
                );
            }
            throw new LastFmProviderError(
                "network",
                "Last.fm request failed.",
                {
                    stage: "response_json",
                    upstreamStatus: response.status,
                    upstreamErrorType: "ResponseBodyError",
                },
            );
        }

        let payload: unknown;
        try {
            payload = JSON.parse(body);
        } catch {
            if (!response.ok) {
                const kind = response.status === 429 ? "rate_limited" : "http";
                throw new LastFmProviderError(
                    kind,
                    `Last.fm request failed with status ${response.status}.`,
                    errorDetails(
                        null,
                        this.apiKey,
                        "response_json",
                        response.status,
                        response.headers.get("Retry-After"),
                    ),
                );
            }
            throw new LastFmProviderError(
                "malformed",
                "Last.fm returned invalid JSON.",
                { stage: "response_json", upstreamStatus: response.status },
            );
        }
        if (!response.ok) {
            const kind = response.status === 429 ? "rate_limited" : "http";
            throw new LastFmProviderError(
                kind,
                `Last.fm request failed with status ${response.status}.`,
                errorDetails(
                    payload,
                    this.apiKey,
                    "upstream_http",
                    response.status,
                    response.headers.get("Retry-After"),
                ),
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
            const rateLimited = payload.error === 29 || payload.error === "29";
            throw new LastFmProviderError(
                rateLimited ? "rate_limited" : "api",
                "Last.fm reported an API error.",
                errorDetails(payload, this.apiKey, "lastfm_api", response.status),
            );
        }

        const result = validate(payload);
        if (this.cacheEnabled && result.cacheable) {
            this.responseCache.set(cacheKey, body, response.headers);
        }
        return result.value;
    }
}
