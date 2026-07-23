export interface Player {
    id: string;
    name: string;
}

export interface Room {
    code: string;
    players: Player[];
    currentGame: string | null;
    gameData: any;
}