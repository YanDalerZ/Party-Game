export interface Player {
    id: string;
    name: string;
}

export interface Room {
    code: string;
    players: Player[];
    currentGame: string | null;
    gameData: any;
    scores: Record<string, number>;
    globalScores: Record<string, number>;
}