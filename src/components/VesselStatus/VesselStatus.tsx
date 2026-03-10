import { memo } from 'react';
import { useAppContext } from '../../context/AppContext';

const VesselStatus = memo(function VesselStatus() {
    const { state } = useAppContext();
    const gs = state.gameState;

    // Use placeholder values if no active scenario
    const warpCore = gs ? gs.power : 100;
    const hull = gs ? gs.hull : 100;
    const shields = gs ? gs.shields : 100;

    return (
        <div className="glass-panel rounded-xl p-5">
            <div className="mb-4 flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-primary neon-aura-primary"></div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-primary/80">Vessel Status</h3>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                {/* Warp Core */}
                <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Warp Core Stability</span>
                        <span className="text-primary font-mono">{warpCore.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-800">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-primary to-secondary neon-aura-primary transition-all duration-500 ease-out"
                            style={{ width: `${Math.max(0, Math.min(100, warpCore))}%` }}
                        ></div>
                    </div>
                </div>

                {/* Hull Integrity */}
                <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Hull Integrity</span>
                        <span className="text-primary font-mono">{hull.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-800">
                        <div
                            className="h-full rounded-full bg-primary neon-aura-primary transition-all duration-500 ease-out"
                            style={{ width: `${Math.max(0, Math.min(100, hull))}%` }}
                        ></div>
                    </div>
                </div>

                {/* Shield Phase */}
                <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Shield Phase</span>
                        <span className="text-secondary font-mono">{shields.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-800">
                        <div
                            className="h-full rounded-full bg-secondary neon-aura-secondary transition-all duration-500 ease-out"
                            style={{ width: `${Math.max(0, Math.min(100, shields))}%` }}
                        ></div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default VesselStatus;
