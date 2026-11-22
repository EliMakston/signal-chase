import { useState } from "react";
import { Music2 } from "lucide-react";
import type { Song } from "../../game/types";

interface SongCardProps {
    song: Song;
    className?: string;
}

export function SongCard({ song, className = "" }: SongCardProps) {
    const [failedArtwork, setFailedArtwork] = useState<string | null>(null);
    const hasArtwork = song.albumArt !== "" && failedArtwork !== song.albumArt;

    return (
        <div className={`flex min-w-0 items-center gap-3 ${className}`}>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-emerald-400/30 via-primary/20 to-fuchsia-500/30 text-foreground">
                {hasArtwork ? (
                    <img
                        src={song.albumArt}
                        alt={`${song.title} album artwork`}
                        className="h-full w-full object-cover"
                        onError={() => setFailedArtwork(song.albumArt)}
                    />
                ) : (
                    <Music2 className="h-6 w-6" aria-hidden="true" />
                )}
            </div>
            <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{song.title}</p>
                <p className="truncate text-sm text-muted-foreground">{song.artist}</p>
            </div>
        </div>
    );
}
