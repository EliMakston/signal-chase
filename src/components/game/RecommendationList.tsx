import { ArrowRight } from "lucide-react";
import { SongCard } from "./SongCard";
import type { SongGraph } from "../../game/types";
import { getSong } from "../../game/graph";

interface RecommendationListProps {
    graph: SongGraph;
    songIds: string[];
    onSelect: (songId: string) => void;
    disabled?: boolean;
}

export function RecommendationList({
    graph,
    songIds,
    onSelect,
    disabled = false,
}: RecommendationListProps) {
    const recommendations = songIds.flatMap((songId) => {
        const song = getSong(graph, songId);
        return song ? [{ songId, song }] : [];
    });

    if (recommendations.length === 0) {
        return (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                No legal recommendations from this song.
            </p>
        );
    }

    return (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Legal song recommendations">
            {recommendations.map(({ songId, song }) => (
                <li key={songId}>
                    <button
                        type="button"
                        onClick={() => onSelect(songId)}
                        disabled={disabled}
                        aria-label={`Move to ${song.title} by ${song.artist}`}
                        className="group flex min-h-20 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background/70 p-3 text-left transition-colors hover:border-primary/60 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <SongCard song={song} />
                        <ArrowRight
                            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground"
                            aria-hidden="true"
                        />
                    </button>
                </li>
            ))}
        </ul>
    );
}
