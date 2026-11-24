import { describe, expect, it } from "vitest";
import {
    canStartCustomRace,
    createInitialCustomRaceState,
    customRaceReducer,
} from "./customRaceState";

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
});
