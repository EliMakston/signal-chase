import { parseRetryAfter } from "../../services/retryAfter";
import { PlayerFacingError } from "./playerFacingError";

export class LiveMusicCooldown {
    private until = 0n;
    private generation = 0;
    private readonly listeners = new Set<() => void>();

    constructor(private readonly now: () => number = Date.now) {}

    remaining(): bigint {
        const remaining = this.until - BigInt(Math.floor(this.now()));
        return remaining > 0n ? (remaining + 999n) / 1000n : 0n;
    }

    readonly isActive = (): boolean => this.remaining() > 0n;
    readonly getGeneration = (): number => this.generation;

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    readonly fetch: typeof fetch = async (input, init) => {
        if (this.remaining() > 0n) {
            throw new PlayerFacingError("Live music is cooling down. Please wait before retrying.");
        }
        const response = await fetch.call(globalThis, input, init);
        if (
            response.status === 429 ||
            (response.status === 503 && response.headers.get("X-Music-Limit-Source") === "capacity")
        ) {
            const now = this.now();
            const until = BigInt(Math.floor(now)) +
                parseRetryAfter(response.headers.get("Retry-After"), () => now) * 1000n;
            if (until > this.until) {
                this.until = until;
                this.generation += 1;
                this.listeners.forEach((listener) => listener());
            }
        }
        return response;
    };
}
