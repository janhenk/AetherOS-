import type { Scenario } from '../types';

export const SCENARIOS: Scenario[] = [
    {
        id: 'kobayashi_maru',
        title: 'Kobayashi Maru',
        description: 'A tactical, no-win training simulation against infinite hostile vessels. Test your command under impossible odds.',
        startingState: {
            hull: 100,
            shields: 100,
            power: 100,
            oxygen: 100,
            alertLevel: 'RED',
            location: 'Neutral Zone (Gamma Hydra Sector)',
            missionStatus: 'ongoing'
        },
        gmSystemPrompt: `You are the Game Master for a Star Trek simulator. The scenario is the Kobayashi Maru.
The player has entered the Neutral Zone to rescue a disabled freighter.
Hostile Klingon battlecruisers drop out of cloak and attack immediately.
No matter what the player does, more ships arrive and deal inevitable damage.
Maintain a dramatic, tense narrative.`
    },
    {
        id: 'temporal_anomaly',
        title: 'Temporal Anomaly',
        description: 'Navigate a collapsing subspace anomaly. Power drains rapidly; engineering ingenuity is required to escape.',
        startingState: {
            hull: 100,
            shields: 60,
            power: 45,
            oxygen: 100,
            alertLevel: 'YELLOW',
            location: 'Typhon Expanse',
            missionStatus: 'ongoing'
        },
        gmSystemPrompt: `You are the Game Master for a Star Trek simulator. The scenario is a Temporal Anomaly.
The ship is trapped in a spatial rift that rapidly drains warp power and damages shields over time.
The player must coordinate between Navigation and Logistics to calculate an escape vector and route emergency power.
Hostile actions are environmental (gravity shears, radiation bursts).`
    },
    {
        id: 'neutral_zone',
        title: 'Neutral Zone Patrol',
        description: 'A tense diplomatic mission. Maintain stealth and avoid provoking the Romulan Star Empire while gathering intelligence.',
        startingState: {
            hull: 100,
            shields: 100,
            power: 100,
            oxygen: 100,
            alertLevel: 'GREEN',
            location: 'Romulan Neutral Zone',
            missionStatus: 'ongoing'
        },
        gmSystemPrompt: `You are the Game Master for a Star Trek simulator. The scenario is a Neutral Zone Patrol.
The ship is tasked with gathering intelligence near the Romulan border without being detected or provoking an attack.
The player must balance using active sensors (which reveal their position) with staying hidden.
If the player acts aggressively, Romulan Warbirds will uncloak and attack. You may grant missionStatus: 'success' if they gather enough data and warp out safely.`
    }
];
