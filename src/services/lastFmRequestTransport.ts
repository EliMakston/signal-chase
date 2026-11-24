import { parseRetryAfter } from "./retryAfter";

export type LastFmMethod = "track.search" | "track.getInfo" | "track.getsimilar";

export interface LastFmTransportRequest {
    method: LastFmMethod;
    params: Readonly<Record<string, string>>;
    apiKey: string;
    signal: AbortSignal;
}

export interface LastFmRequestTransport {
    /** Implementations check cooldown and account immediately before dispatch, and record HTTP 429 on receipt. */
    dispatch(request: LastFmTransportRequest): Promise<Response>;
    recordThrottle(retryAfter: string | null): bigint;
    remainingCooldown(): bigint;
}

export interface LastFmCooldown {
    activate(retryAfter: string | null): bigint;
    remaining(): bigint;
}

export class LocalLastFmCooldown implements LastFmCooldown {
    private until = 0n;

    constructor(private readonly now: () => number = Date.now) {}

    activate(retryAfter: string | null): bigint {
        const now = this.now();
        const deadline = BigInt(Math.floor(now)) + parseRetryAfter(retryAfter, () => now) * 1000n;
        if (deadline > this.until) this.until = deadline;
        return this.remaining();
    }

    remaining(): bigint {
        const remainingMs = this.until - BigInt(Math.floor(this.now()));
        return remainingMs > 0n ? (remainingMs + 999n) / 1000n : 0n;
    }

    reset(): void {
        this.until = 0n;
    }
}

export class LastFmCooldownError extends Error {
    constructor(readonly retryAfterSeconds: bigint) {
        super("Last.fm is temporarily rate-limited.");
        this.name = "LastFmCooldownError";
    }
}

export class LastFmRequestAccounting {
    private providerInvocations = 0;
    private outboundAttempts = 0;
    private cacheHits = 0;

    recordProviderInvocation(): void {
        this.providerInvocations += 1;
    }

    recordOutboundAttempt(): void {
        this.outboundAttempts += 1;
    }

    recordCacheHit(): void {
        this.cacheHits += 1;
    }

    snapshot(): Readonly<{
        providerInvocations: number;
        outboundAttempts: number;
        cacheHits: number;
    }> {
        return {
            providerInvocations: this.providerInvocations,
            outboundAttempts: this.outboundAttempts,
            cacheHits: this.cacheHits,
        };
    }
}

export const lastFmRequestAccounting = new LastFmRequestAccounting();
export const lastFmCooldown = new LocalLastFmCooldown();

export class LocalLastFmRequestTransport implements LastFmRequestTransport {
    constructor(
        private readonly fetcher: typeof fetch = fetch,
        private readonly accounting: LastFmRequestAccounting = lastFmRequestAccounting,
        private readonly cooldown: LastFmCooldown = lastFmCooldown,
    ) {}

    async dispatch({ method, params, apiKey, signal }: LastFmTransportRequest): Promise<Response> {
        const searchParams = new URLSearchParams({
            ...params,
            method,
            api_key: apiKey,
            format: "json",
        });
        const url = `https://ws.audioscrobbler.com/2.0/?${searchParams}`;
        signal.throwIfAborted();
        const remaining = this.cooldown.remaining();
        if (remaining > 0n) throw new LastFmCooldownError(remaining);
        this.accounting.recordOutboundAttempt();
        const response = await this.fetcher.call(globalThis, url, {
            headers: {
                "User-Agent": "SignalChase/0.1.1 (https://signal-chase.app.space)",
            },
            signal,
        });
        if (response.status === 429) this.cooldown.activate(response.headers.get("Retry-After"));
        return response;
    }

    recordThrottle(retryAfter: string | null): bigint {
        return this.cooldown.activate(retryAfter);
    }

    remainingCooldown(): bigint {
        return this.cooldown.remaining();
    }
}
