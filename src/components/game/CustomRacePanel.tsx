import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { SongCard } from "./SongCard";
import { AlbumArtwork } from "./AlbumArtwork";
import type { Song } from "../../game/types";
import type {
    CustomRaceAction,
    CustomRaceState,
    CustomSongRole,
} from "./customRaceState";
import {
    canStartCustomRace,
    getCustomRaceReadiness,
} from "./customRaceState";
import {
    createSongSearchController,
    searchLocalSongs,
} from "./songSearch";
import type { SongSearchState } from "./songSearch";

function SongSearchField({
    role,
    selectedSong,
    unavailableSongId,
    dispatch,
    localSongs,
}: {
    role: CustomSongRole;
    selectedSong: Song | null;
    unavailableSongId: string | null;
    dispatch: (action: CustomRaceAction) => void;
    localSongs?: readonly Song[];
}) {
    const [query, setQuery] = useState("");
    const [searchState, setSearchState] = useState<SongSearchState>({
        status: "idle",
        songs: [],
        error: null,
    });
    const [retryCount, setRetryCount] = useState(0);
    const controller = useMemo(() => createSongSearchController(), []);
    const inputRef = useRef<HTMLInputElement>(null);
    const inputId = `${role}-song-search`;
    const feedbackId = `${inputId}-feedback`;
    const resultsHeadingId = `${inputId}-results-heading`;

    useEffect(
        () =>
            localSongs === undefined
                ? controller.search(query, setSearchState)
                : undefined,
        [controller, localSongs, query, retryCount],
    );

    const displayedSearchState: SongSearchState =
        localSongs === undefined
            ? searchState
            : (() => {
                  const songs = searchLocalSongs(localSongs, query);
                  return {
                      status: songs.length ? "results" : "empty",
                      songs,
                      error: null,
                  };
              })();
    const isLocal = localSongs !== undefined;
    const label = role === "start" ? "Starting song" : "Destination song";
    return (
        <section
            className={`radio-terminal-panel radio-song-picker min-w-0 p-3 sm:p-4 ${
                role === "start" ? "radio-origin-panel" : "radio-destination-panel"
            }`}
            aria-label={`${label} selection`}
        >
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
                {label}
                <input
                    ref={inputRef}
                    id={inputId}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder={`Search for a ${role === "start" ? "starting" : "destination"} song`}
                    aria-label={`${label} search`}
                    aria-describedby={
                        displayedSearchState.status === "idle" ||
                        displayedSearchState.status === "results"
                            ? undefined
                            : feedbackId
                    }
                    className="radio-inset-display radio-search-input h-11 w-full px-3 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
            </label>

            {selectedSong && (
                <div className="radio-selected-song mt-3 flex min-w-0 items-center justify-between gap-2 p-2.5 sm:gap-3 sm:p-3">
                    <div className="min-w-0">
                        <p className="radio-technical-label mb-2">
                            {role === "start" ? "Selected origin" : "Selected destination"}
                        </p>
                        <SongCard
                            song={selectedSong}
                            className="[&>div:first-child]:h-11 [&>div:first-child]:w-11 [&_p:first-child]:text-sm [&_p:last-child]:text-xs"
                        />
                    </div>
                    <Button
                        variant="outline"
                        className="radio-mechanical-button shrink-0 px-3"
                        onClick={() => dispatch({ type: "clear-song", role })}
                    >
                        Change
                    </Button>
                </div>
            )}

            <div className="mt-3">
                {displayedSearchState.status === "loading" && (
                    <p
                        id={feedbackId}
                        role="status"
                        aria-live="polite"
                        className="radio-search-feedback flex min-h-11 items-center gap-2 px-3 text-sm text-muted-foreground"
                    >
                        Searching Last.fm…
                    </p>
                )}
                {displayedSearchState.status === "empty" && (
                    <p
                        id={feedbackId}
                        role="status"
                        aria-live="polite"
                        className="radio-search-feedback min-h-11 px-3 py-3 text-sm text-muted-foreground"
                    >
                        {isLocal
                            ? "No songs match this search in the selected network."
                            : "No songs found. Try another search."}
                    </p>
                )}
                {displayedSearchState.status === "error" && (
                    <div id={feedbackId} role="alert" className="radio-search-error space-y-2 p-3">
                        <p className="text-sm text-foreground">{displayedSearchState.error}</p>
                        <Button
                            variant="outline"
                            className="radio-mechanical-button"
                            onClick={() => {
                                inputRef.current?.focus();
                                setRetryCount((count) => count + 1);
                            }}
                        >
                            Retry search
                        </Button>
                    </div>
                )}
                {displayedSearchState.songs.length > 0 && (
                    <>
                        <h3
                            id={resultsHeadingId}
                            className="radio-technical-label mb-2"
                        >
                            {label} search results
                        </h3>
                        <ul
                            aria-labelledby={resultsHeadingId}
                            className="radio-search-results grid max-h-72 gap-2 overflow-y-auto"
                        >
                            {displayedSearchState.songs.map((song, index) => {
                                const selected = selectedSong?.id === song.id;
                                const duplicate = unavailableSongId === song.id;
                                const actionLabel = selected
                                    ? "Selected"
                                    : duplicate
                                      ? "Already selected"
                                      : "Select";
                                return (
                                    <li
                                        key={song.id}
                                        className="radio-search-result-item flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center"
                                    >
                                        <Button
                                            variant={selected ? "secondary" : "outline"}
                                            className="radio-search-result radio-mechanical-button h-auto min-w-0 flex-1 justify-between gap-2 whitespace-normal px-2.5 py-2 text-left sm:px-3"
                                            disabled={duplicate}
                                            aria-pressed={selected}
                                            onClick={() =>
                                                dispatch({
                                                    type: "select-song",
                                                    role,
                                                    song,
                                                })
                                            }
                                        >
                                            <span className="radio-recommendation-index" aria-hidden="true">
                                                {String(index + 1).padStart(2, "0")}
                                            </span>
                                            <AlbumArtwork
                                                albumArt={song.albumArt}
                                                className="h-10 w-10 shrink-0"
                                            />
                                            <span className="min-w-0 [overflow-wrap:anywhere]">
                                                <span className="block font-medium">{song.title}</span>
                                                <span className="block text-xs text-muted-foreground">
                                                    {song.artist}
                                                </span>
                                            </span>
                                            <span className="ml-3 shrink-0 text-xs">
                                                {actionLabel}
                                            </span>
                                        </Button>
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                )}
            </div>
        </section>
    );
}

export function CustomRacePanel({
    state,
    dispatch,
    onStart,
    localSongs,
    localDemo,
    readiness,
}: {
    state: CustomRaceState;
    dispatch: (action: CustomRaceAction) => void;
    onStart: () => void;
    localSongs?: readonly Song[];
    localDemo: boolean;
    readiness?: { ready: boolean; message: string };
}) {
    const ready = canStartCustomRace(state) && (readiness?.ready ?? true);

    return (
        <section className="radio-setup-console radio-terminal-panel mx-auto w-full min-w-0 p-3 sm:p-5 lg:p-6">
            <header className="radio-setup-header mb-4 flex flex-col gap-3 border-b border-border pb-4 sm:mb-5 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                    <p className="radio-technical-label mb-2">Custom route configuration</p>
                    <h2 className="radio-heading text-xl sm:text-2xl">Choose your race songs</h2>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                        {localDemo
                            ? "Browse or search songs in the selected curated network, then choose different endpoints."
                            : "Search Last.fm, then select different songs for the origin and destination."}
                    </p>
                </div>
                <p
                    className={`radio-readiness-indicator shrink-0 ${ready ? "is-ready" : ""}`}
                    aria-live="polite"
                    aria-atomic="true"
                >
                    <span aria-hidden="true" />
                    {ready ? "Route endpoints ready" : "Select both endpoints"}
                </p>
            </header>
            <div className="radio-endpoint-pickers grid min-w-0 gap-3 md:grid-cols-2 sm:gap-4">
                <SongSearchField
                    role="start"
                    selectedSong={state.startSong}
                    unavailableSongId={state.targetSong?.id ?? null}
                    dispatch={dispatch}
                    localSongs={localSongs}
                />
                <SongSearchField
                    role="target"
                    selectedSong={state.targetSong}
                    unavailableSongId={state.startSong?.id ?? null}
                    dispatch={dispatch}
                    localSongs={localSongs}
                />
            </div>
            {readiness && state.startSong && state.targetSong && !readiness.ready && (
                <p
                    className="mt-3 text-sm text-destructive"
                    role="status"
                    aria-live="polite"
                >
                    {readiness.message}
                </p>
            )}
            <footer className="radio-setup-footer mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:mt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="mt-1 text-sm text-muted-foreground">
                    {localDemo
                        ? "Curated connections are available offline; no music service is contacted."
                        : "Recommendations are explored after the race starts."}
                </p>
                <Button
                    className="radio-mechanical-button radio-primary-action w-full justify-center sm:w-auto"
                    disabled={!ready}
                    onClick={onStart}
                >
                    Start Race
                </Button>
            </footer>
        </section>
    );
}
