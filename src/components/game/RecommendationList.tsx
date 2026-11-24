import { ArrowRight } from "lucide-react";
import { SongCard } from "./SongCard";
import type { SongGraph } from "../../game/types";
import { getSong } from "../../game/graph";
import { LastFmTrackLink } from "./LastFmTrackLink";

interface RecommendationListProps {
    graph: SongGraph;
    songIds: string[];
    onSelect: (songId: string) => void;
    disabled?: boolean;
    ariaLabel?: string;
}

export function RecommendationList({
    graph,
    songIds,
    onSelect,
    disabled = false,
    ariaLabel = "Legal song recommendations",
}: RecommendationListProps) {
    const recommendations = songIds.flatMap((songId) => {
        const song = getSong(graph, songId);
        return song ? [{ songId, song }] : [];
    });

    if (recommendations.length === 0) {
        return (
            <p className="radio-inset-display px-4 py-6 text-center text-sm text-muted-foreground">
                No legal recommendations from this song.
            </p>
        );
    }

    return (
        <ul className="grid min-w-0 gap-2" aria-label={ariaLabel}>
            {recommendations.map(({ songId, song }, index) => (
                <li
                    key={songId}
                    className="radio-recommendation-item flex min-w-0 flex-col gap-1 sm:flex-row sm:items-stretch"
                >
                    <button
                        type="button"
                        onClick={() => onSelect(songId)}
                        disabled={disabled}
                        aria-label={`Move to ${song.title} by ${song.artist}`}
                        className="radio-mechanical-button radio-recommendation-row group flex min-h-16 min-w-0 flex-1 items-center gap-2 p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 sm:gap-3 sm:p-3"
                    >
                        <span className="radio-recommendation-index" aria-hidden="true">
                            {String(index + 1).padStart(2, "0")}
                        </span>
                        <SongCard
                            song={song}
                            className="min-w-0 flex-1 [&>div:first-child]:h-11 [&>div:first-child]:w-11 [&_p:first-child]:text-sm [&_p:last-child]:text-xs"
                        />
                        <ArrowRight
                            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground motion-reduce:transition-none"
                            aria-hidden="true"
                        />
                    </button>
                    <LastFmTrackLink
                        url={song.lastFmUrl}
                        title={song.title}
                        artist={song.artist}
                    />
                </li>
            ))}
        </ul>
    );
}
