import { GoogleGenAI, Type } from '@google/genai';
import type { ShipState, Scenario } from '../types';

export interface GMResponse {
    hullDelta: number;
    shieldsDelta: number;
    powerDelta: number;
    oxygenDelta: number;
    alertLevel: 'GREEN' | 'YELLOW' | 'RED';
    missionStatus: 'ongoing' | 'success' | 'failure';
    narrativeEvent: string;
}

const gmResponseSchema = {
    type: Type.OBJECT,
    properties: {
        hullDelta: { type: Type.INTEGER, description: 'Change to hull integrity (e.g., -10 for damage)' },
        shieldsDelta: { type: Type.INTEGER, description: 'Change to shields (e.g., -20 for damage)' },
        powerDelta: { type: Type.INTEGER, description: 'Change to warp core power' },
        oxygenDelta: { type: Type.INTEGER, description: 'Change to oxygen level' },
        alertLevel: { type: Type.STRING, enum: ['GREEN', 'YELLOW', 'RED'] },
        missionStatus: { type: Type.STRING, enum: ['ongoing', 'success', 'failure'], description: 'Whether the scenario is ongoing, won, or lost' },
        narrativeEvent: { type: Type.STRING, description: 'The narrative consequence of the turn' }
    },
    required: ['hullDelta', 'shieldsDelta', 'powerDelta', 'oxygenDelta', 'alertLevel', 'missionStatus', 'narrativeEvent']
};

export async function evaluateTurn(
    client: GoogleGenAI,
    model: string,
    scenario: Scenario,
    currentState: ShipState,
    playerCommand: string,
    agentReply: string,
    agentName: string
): Promise<GMResponse> {
    const prompt = `
SCENARIO: ${scenario.title}
${scenario.description}

CURRENT SHIP STATE:
Hull: ${currentState.hull}
Shields: ${currentState.shields}
Power: ${currentState.power}
Oxygen: ${currentState.oxygen}
Alert Level: ${currentState.alertLevel}
Location: ${currentState.location}

PLAYER COMMAND TO ${agentName.toUpperCase()}: "${playerCommand}"
${agentName.toUpperCase()} REPLIED: "${agentReply}"

Evaluate the consequences of this turn based on your Game Master instructions.
Update the ship state deltas and provide the next narrative event.
If the player takes damage, say so in the narrative event. 
Return ONLY JSON.
`;

    try {
        const response = await client.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                systemInstruction: scenario.gmSystemPrompt,
                responseMimeType: 'application/json',
                responseSchema: gmResponseSchema,
                temperature: 0.7
            }
        });

        const text = response.text;
        if (!text) throw new Error("Empty response from GM");
        return JSON.parse(text) as GMResponse;
    } catch (err) {
        console.error('Failed to query Game Master:', err);
        return {
            hullDelta: 0,
            shieldsDelta: 0,
            powerDelta: 0,
            oxygenDelta: 0,
            alertLevel: currentState.alertLevel,
            missionStatus: currentState.missionStatus,
            narrativeEvent: "⚠ SENSORS OFFLINE. Unable to assess situation."
        };
    }
}
