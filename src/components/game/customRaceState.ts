import type { Song } from "../../game/types";
import type { SongGraph } from "../../game/types";
import { findShortestPath } from "../../game/pathfinding";

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
    | { type: "clear-selections" }
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
            return {
                ...state,
                startSong: null,
                targetSong: null,
                playing: false,
            };
        case "clear-selections":
            return { ...state, startSong: null, targetSong: null };
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

export function getCustomRaceReadiness(
    state: CustomRaceState,
    graph?: SongGraph | null,
): { ready: boolean; message: string } {
    if (!state.startSong || !state.targetSong) {
        return { ready: false, message: "Select both race endpoints." };
    }
    if (state.startSong.id === state.targetSong.id) {
        return { ready: false, message: "Choose two different songs." };
    }
    if (graph === undefined) {
        return { ready: true, message: "Route endpoints ready." };
    }
    if (graph === null) {
        return { ready: false, message: "The selected Demo network is unavailable." };
    }
    if (
        !graph.nodes.has(state.startSong.id) ||
        !graph.nodes.has(state.targetSong.id)
    ) {
        return {
            ready: false,
            message: "Both songs must belong to the selected Demo network.",
        };
    }
    if (!findShortestPath(graph, state.startSong.id, state.targetSong.id)) {
        return {
            ready: false,
            message:
                "No directed route connects these songs in the selected Demo network.",
        };
    }
    return { ready: true, message: "A route connects these endpoints." };
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
