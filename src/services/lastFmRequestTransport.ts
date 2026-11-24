export type LastFmMethod = "track.search" | "track.getInfo" | "track.getsimilar";

export interface LastFmTransportRequest {
    method: LastFmMethod;
    params: Readonly<Record<string, string>>;
    apiKey: string;
    signal: AbortSignal;
}

export interface LastFmRequestTransport {
    /** Implementations account for each outbound attempt immediately before network dispatch. */
    dispatch(request: LastFmTransportRequest): Promise<Response>;
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

export class LocalLastFmRequestTransport implements LastFmRequestTransport {
    constructor(
        private readonly fetcher: typeof fetch = fetch,
        private readonly accounting: LastFmRequestAccounting = lastFmRequestAccounting,
    ) {}

    dispatch({ method, params, apiKey, signal }: LastFmTransportRequest): Promise<Response> {
        const searchParams = new URLSearchParams({
            ...params,
            method,
            api_key: apiKey,
            format: "json",
        });
        const url = `https://ws.audioscrobbler.com/2.0/?${searchParams}`;
        this.accounting.recordOutboundAttempt();
        return this.fetcher.call(globalThis, url, {
            headers: {
                "User-Agent": "SignalChase/0.1.1 (https://signal-chase.app.space)",
            },
            signal,
        });
    }
}
