export class PlayerFacingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PlayerFacingError";
    }
}

export function getPlayerFacingErrorMessage(
    error: unknown,
    fallback: string,
): string {
    return error instanceof PlayerFacingError ? error.message : fallback;
}

export async function getMusicServiceErrorMessage(
    response: Response,
    fallback: string,
): Promise<string> {
    let code: string | null = null;
    try {
        const payload: unknown = await response.json();
        if (
            typeof payload === "object" &&
            payload !== null &&
            !Array.isArray(payload) &&
            "code" in payload &&
            typeof payload.code === "string"
        ) {
            code = payload.code;
        }
    } catch {
        // Non-JSON proxy and network errors use the status-based message below.
    }

    if (code === "live_music_disabled") {
        return "Live Last.fm functionality is disabled. Demo mode is available.";
    }
    if (code === "rate_limited" || response.status === 429) {
        return "Live music requests are temporarily rate-limited. Please wait before retrying.";
    }
    if (code === "upstream_timeout" || response.status === 504) {
        return "The music provider timed out. Please retry.";
    }
    if (code === "music_protection_unavailable") {
        return "Live music is temporarily unavailable. Demo mode remains available.";
    }
    if (response.status === 503) {
        return "Last.fm is not available right now. Demo mode remains available.";
    }
    if (response.status >= 500) {
        return fallback;
    }
    return `The request was rejected (HTTP ${response.status}).`;
}
