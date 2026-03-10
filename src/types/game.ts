export interface ShipState {
    hull: number;       // 0 - 100
    shields: number;    // 0 - 100
    power: number;      // 0 - 100 (Warp Core)
    oxygen: number;     // 0 - 100
    alertLevel: 'GREEN' | 'YELLOW' | 'RED';
    location: string;
    missionStatus: 'ongoing' | 'success' | 'failure';
}

export interface GameEvent {
    id: string;
    narrativeText: string;
    type: 'damage' | 'status' | 'story' | 'system';
}

export interface Scenario {
    id: string;
    title: string;
    description: string;
    startingState: ShipState;
    gmSystemPrompt: string;
}
