export type GameStatus = "playing" | "won";

export interface GameState {
    startSongId: string;
    targetSongId: string;
    currentSongId: string;
    visitedSongs: string[];
    moves: number;
    status: GameStatus;
}
