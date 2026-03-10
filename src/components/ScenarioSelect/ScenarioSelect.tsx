import { memo } from 'react';
import { SCENARIOS } from '../../scenarios';
import { useAppContext } from '../../context/AppContext';

const ScenarioSelect = memo(function ScenarioSelect() {
    const { dispatch } = useAppContext();

    return (
        <div className="flex flex-col items-center justify-center p-8 w-full h-full">
            <h2 className="text-2xl font-bold tracking-[0.15em] text-primary mb-12 uppercase neon-aura-primary p-4 rounded-xl glass-panel">
                Select Simulation Scenario
            </h2>

            <div className="flex flex-wrap justify-center gap-6 max-w-4xl">
                {SCENARIOS.map((scenario) => (
                    <div
                        key={scenario.id}
                        className="glass-panel border-t-4 border-t-primary rounded-xl p-6 w-80 flex flex-col gap-4 hover:neon-aura-primary transition-all duration-300"
                    >
                        <h3 className="text-lg font-bold tracking-wide text-primary uppercase">
                            {scenario.title}
                        </h3>

                        <p className="font-mono text-sm text-slate-400 leading-relaxed flex-1">
                            {scenario.description}
                        </p>

                        <button
                            onClick={() => dispatch({ type: 'START_SCENARIO', payload: { scenario, state: scenario.startingState } })}
                            className="self-start px-6 py-2 rounded-full border border-primary text-primary text-xs font-bold tracking-widest uppercase transition-colors hover:bg-primary hover:text-background-dark"
                        >
                            Initialize
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
});

export default ScenarioSelect;
