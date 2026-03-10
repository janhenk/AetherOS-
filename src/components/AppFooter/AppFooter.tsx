import { memo } from 'react';
import { useAppContext } from '../../context/AppContext';

const AppFooter = memo(function AppFooter() {
    const { state } = useAppContext();
    const isRedAlert = state.gameState?.alertLevel === 'RED';

    return (
        <footer className="mt-auto border-t border-primary/10 bg-background-dark/80 px-8 py-3 text-center backdrop-blur-md">
            <div className="flex items-center justify-between">
                <div className="flex gap-6">
                    <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${isRedAlert ? 'bg-red-500 neon-aura-secondary' : 'bg-emerald-500 neon-aura-primary'}`}></span>
                        <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                            Life Support: {state.gameState ? `${Math.round(state.gameState.oxygen)}%` : 'Optimal'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-primary neon-aura-primary"></span>
                        <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                            Gravity: {isRedAlert ? '1.2G' : '1.0G'}
                        </span>
                    </div>
                </div>
                <p className="text-[10px] uppercase tracking-widest text-slate-500">© 2145 Aether Galactic. All rights reserved.</p>
            </div>
        </footer>
    );
});

export default AppFooter;
