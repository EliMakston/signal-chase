import { useState } from "react";
import { Disc3 } from "lucide-react";

const LAST_FM_PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f";

export function getAlbumArtworkSource(albumArt: string): string | null {
    const source = albumArt.trim();
    if (!source || source.toLowerCase().includes(LAST_FM_PLACEHOLDER_HASH)) {
        return null;
    }

    if (
        source.startsWith("/") &&
        !source.startsWith("//") &&
        !source.includes("\\")
    ) {
        return source;
    }

    try {
        const url = new URL(source);
        const isLastFmHost = url.hostname
            .split(".")
            .some((label) => /last[-]?fm/i.test(label));
        if (url.protocol !== "https:" || isLastFmHost) {
            return null;
        }
        return url.href;
    } catch {
        return null;
    }
}

export function AlbumArtwork({
    albumArt,
    className = "h-14 w-14",
    loading = "lazy",
}: {
    albumArt: string;
    className?: string;
    loading?: "eager" | "lazy";
}) {
    const source = getAlbumArtworkSource(albumArt);
    const [failedSource, setFailedSource] = useState<string | null>(null);
    const hasArtwork = source !== null && failedSource !== source;

    return (
        <div
            className={`radio-album-art ${className}`}
            aria-hidden="true"
        >
            {hasArtwork ? (
                <img
                    src={source}
                    alt=""
                    loading={loading}
                    decoding="async"
                    onError={() => setFailedSource(source)}
                />
            ) : (
                <Disc3 className="radio-album-art-fallback" aria-hidden="true" />
            )}
        </div>
    );
}
