import { describe, expect, it } from "vitest";
import {
    canStartCustomRace,
    createInitialCustomRaceState,
    customRaceReducer,
    getCustomRaceReadiness,
} from "./customRaceState";
import type { SongGraph } from "../../game/types";
import { searchLocalSongs } from "./songSearch";

const startSong = {
    id: "lastfm:Artist:Start",
    title: "Start",
    artist: "Artist",
    albumArt: "",
};
const targetSong = {
    id: "lastfm:Artist:Target",
    title: "Target",
    artist: "Artist",
    albumArt: "",
};

describe("custom race selection state", () => {
    it("starts in Random mode and preserves the existing selection when entering Custom", () => {
        const initial = createInitialCustomRaceState();
        const custom = customRaceReducer(initial, {
            type: "set-mode",
            mode: "custom",
        });

        expect(initial.mode).toBe("random");
        expect(custom).toMatchObject({
            mode: "custom",
            startSong: null,
            targetSong: null,
        });
    });

    it("selects different start and destination songs and reports readiness", () => {
        let state = customRaceReducer(createInitialCustomRaceState(), {
            type: "set-mode",
            mode: "custom",
        });
        state = customRaceReducer(state, {
            type: "select-song",
            role: "start",
            song: startSong,
        });
        expect(canStartCustomRace(state)).toBe(false);

        state = customRaceReducer(state, {
            type: "select-song",
            role: "target",
            song: targetSong,
        });
        expect(state.startSong).toEqual(startSong);
        expect(state.targetSong).toEqual(targetSong);
        expect(canStartCustomRace(state)).toBe(true);
    });

    it("prevents selecting the same song for both endpoints", () => {
        const selectedStart = customRaceReducer(
            customRaceReducer(createInitialCustomRaceState(), {
                type: "set-mode",
                mode: "custom",
            }),
            { type: "select-song", role: "start", song: startSong },
        );
        const duplicate = customRaceReducer(selectedStart, {
            type: "select-song",
            role: "target",
            song: startSong,
        });

        expect(duplicate).toBe(selectedStart);
        expect(duplicate.targetSong).toBeNull();
        expect(canStartCustomRace(duplicate)).toBe(false);
    });

    it("clears custom selections when returning to Random mode", () => {
        const selected = {
            mode: "custom" as const,
            startSong,
            targetSong,
            playing: false,
        };
        const random = customRaceReducer(selected, {
            type: "set-mode",
            mode: "random",
        });

        expect(random).toEqual({
            mode: "random",
            startSong: null,
            targetSong: null,
            playing: false,
        });
    });

    it("checks Demo endpoint membership and directed reachability", () => {
        const state = {
            mode: "custom" as const,
            startSong,
            targetSong,
            playing: false,
        };
        const graph: SongGraph = {
            nodes: new Map([
                [startSong.id, startSong],
                [targetSong.id, targetSong],
            ]),
            edges: new Map([
                [startSong.id, [targetSong.id]],
                [targetSong.id, []],
            ]),
        };
        expect(getCustomRaceReadiness(state, graph).ready).toBe(true);
        expect(
            getCustomRaceReadiness(state, {
                ...graph,
                edges: new Map([
                    [startSong.id, []],
                    [targetSong.id, []],
                ]),
            }).message,
        ).toContain("No directed route");
        expect(getCustomRaceReadiness(state, null).ready).toBe(false);
    });

    it("clears endpoint selections for a new custom race", () => {
        const selected = {
            mode: "custom" as const,
            startSong,
            targetSong,
            playing: true,
        };
        expect(
            customRaceReducer(selected, { type: "new-custom-race" }),
        ).toEqual({
            mode: "custom",
            startSong: null,
            targetSong: null,
            playing: false,
        });
    });

    describe("offline song search", () => {
        const catalogue = [
            { id: "1", title: "Track Alpha", artist: "The Exact Artist", albumArt: "" },
            { id: "2", title: "Exact Artist", artist: "Another Band", albumArt: "" },
            { id: "3", title: "A Longer Exact Artist Song", artist: "Other", albumArt: "" },
            { id: "4", title: "Unrelated", artist: "Exact Artist Project", albumArt: "" },
        ];

        it("matches titles and artists case-insensitively with normalized partial queries", () => {
            expect(searchLocalSongs(catalogue, "  TRACK   ALP ")).toEqual([
                catalogue[0],
            ]);
            expect(searchLocalSongs(catalogue, "artist")).toHaveLength(4);
        });

        it("ranks exact title and artist matches above partial matches deterministically", () => {
            expect(searchLocalSongs(catalogue, "exact artist").map(({ id }) => id))
                .toEqual(["2", "1", "3", "4"]);
        });

        it("returns the catalogue for an empty query and no results for a miss", () => {
            expect(searchLocalSongs(catalogue, " \t ")).toEqual(catalogue);
            expect(searchLocalSongs(catalogue, "not in this catalogue")).toEqual([]);
        });
    });
});
