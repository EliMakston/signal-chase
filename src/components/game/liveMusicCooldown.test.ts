import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveMusicCooldown } from "./liveMusicCooldown";
import { createSongSearchController } from "./songSearch";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("live music cooldown", () => {
    it("blocks cross-method requests and requires a manual retry after expiry", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "2" } }))
            .mockResolvedValue(new Response(JSON.stringify({ songs: [] })));
        vi.stubGlobal("fetch", fetcher);
        const cooldown = new LiveMusicCooldown();
        await cooldown.fetch("/api/music/graph");
        expect(cooldown.remaining()).toBe(2n);
        const updates: string[] = [];
        const controller = createSongSearchController(cooldown.fetch, 300, cooldown.isActive, cooldown.getGeneration);
        controller.search("changed query", (state) => updates.push(state.status));
        expect(updates).toEqual(["error"]);
        await expect(cooldown.fetch("/api/music/similar")).rejects.toThrow("cooling down");
        await vi.advanceTimersByTimeAsync(2000);
        expect(cooldown.remaining()).toBe(0n);
        expect(fetcher).toHaveBeenCalledTimes(1);
        controller.search("changed query", (state) => updates.push(state.status));
        await vi.advanceTimersByTimeAsync(300);
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(updates).toEqual(["error", "loading", "empty"]);
    });

    it("does not dispatch a queued search if a cooldown started and expired before its timer", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response("{}", { status: 429, headers: { "Retry-After": "1" } }),
        );
        vi.stubGlobal("fetch", fetcher);
        const cooldown = new LiveMusicCooldown();
        const controller = createSongSearchController(cooldown.fetch, 2000, cooldown.isActive, cooldown.getGeneration);
        const updates: string[] = [];
        controller.search("queued", (state) => updates.push(state.status));
        await cooldown.fetch("/api/music/graph");
        await vi.advanceTimersByTimeAsync(2000);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(updates).toEqual(["loading", "error"]);
    });
});
