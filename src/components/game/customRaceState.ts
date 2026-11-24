import type { Song } from "../../game/types";

export type RaceMode = "random" | "custom";
export type CustomSongRole = "start" | "target";

export interface CustomRaceState {
    mode: RaceMode;
    startSong: Song | null;
    targetSong: Song | null;
    playing: boolean;
}

export type CustomRaceAction =
    | { type: "set-mode"; mode: RaceMode }
    | { type: "race-started" }
    | { type: "new-custom-race" }
    | { type: "select-song"; role: CustomSongRole; song: Song }
    | { type: "clear-song"; role: CustomSongRole };

export function createInitialCustomRaceState(): CustomRaceState {
    return { mode: "random", startSong: null, targetSong: null, playing: false };
}

export function customRaceReducer(
    state: CustomRaceState,
    action: CustomRaceAction,
): CustomRaceState {
    switch (action.type) {
        case "set-mode":
            if (state.mode === action.mode) return state;
            return action.mode === "random"
                ? {
                      ...state,
                      mode: action.mode,
                      startSong: null,
                      targetSong: null,
                      playing: false,
                  }
                : { ...state, mode: action.mode, playing: false };
        case "race-started":
            return canStartCustomRace(state)
                ? { ...state, playing: true }
                : state;
        case "new-custom-race":
            return { ...state, playing: false };
        case "select-song":
            if (
                action.role === "start"
                    ? state.targetSong?.id === action.song.id
                    : state.startSong?.id === action.song.id
            ) {
                return state;
            }
            return action.role === "start"
                ? { ...state, startSong: { ...action.song } }
                : { ...state, targetSong: { ...action.song } };
        case "clear-song":
            return action.role === "start"
                ? { ...state, startSong: null }
                : { ...state, targetSong: null };
    }
}

export function canStartCustomRace(state: CustomRaceState): boolean {
    return (
        state.mode === "custom" &&
        !state.playing &&
        state.startSong !== null &&
        state.targetSong !== null &&
        state.startSong.id !== state.targetSong.id
    );
}
