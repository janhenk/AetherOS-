import { memo } from 'react';
import { useAppContext } from '../../context/AppContext';

const GameOver = memo(function GameOver() {
    const { state, dispatch } = useAppContext();

    if (!state.gameState) return null;

    const isDestroyed = state.gameState.hull <= 0 || state.gameState.oxygen <= 0;
    const isSuccess = state.gameState.missionStatus === 'success';
    const isFailure = state.gameState.missionStatus === 'failure' || isDestroyed;

    if (!isSuccess && !isFailure) return null;

    const overlayColorClass = isSuccess ? 'text-primary' : 'text-secondary';
    const overlayBorderClass = isSuccess ? 'border-primary hover:bg-primary' : 'border-secondary hover:bg-secondary';
    const glowClass = isSuccess ? 'neon-aura-primary' : 'neon-aura-secondary';

    const titleText = isSuccess ? 'Mission Accomplished' : 'Simulation Terminated';
    const bodyText = isSuccess
        ? 'Objectives met. The crew performed admirably.'
        : (state.gameState.hull <= 0 ? 'Catastrophic Hull Failure.' : 'Overwhelming Defeat.');

    return (
        <div className="absolute inset-0 z-[100] bg-background-dark/90 backdrop-blur-xl flex flex-col items-center justify-center p-10 text-center">

            <div className={`glass-panel p-12 rounded-3xl border ${isSuccess ? 'border-primary/30' : 'border-secondary/30'} ${glowClass}`}>
                <h2 className={`text-4xl md:text-5xl font-bold tracking-[0.2em] mb-6 uppercase ${overlayColorClass}`}>
                    {titleText}
                </h2>
                <p className="text-xl md:text-2xl text-slate-300 font-mono tracking-wide mb-12">
                    {bodyText}
                </p>

                <button
                    onClick={() => dispatch({ type: 'END_SCENARIO' })}
                    className={`px-8 py-4 rounded-full border-2 bg-transparent text-sm font-bold tracking-widest uppercase transition-all duration-300 hover:text-background-dark ${overlayBorderClass} ${overlayColorClass}`}
                >
                    Acknowledge & Return to Menu
                </button>
            </div>

        </div>
    );
});

export default GameOver;
