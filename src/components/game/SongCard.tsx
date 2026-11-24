import type { Song } from "../../game/types";
import { AlbumArtwork } from "./AlbumArtwork";

interface SongCardProps {
    song: Song;
    className?: string;
}

export function SongCard({ song, className = "" }: SongCardProps) {
    return (
        <div className={`flex min-w-0 items-center gap-3 ${className}`}>
            <AlbumArtwork albumArt={song.albumArt} />
            <div className="min-w-0">
                <p className="break-words font-semibold text-foreground [overflow-wrap:anywhere]">
                    {song.title}
                </p>
                <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {song.artist}
                </p>
            </div>
        </div>
    );
}
