import { memo } from 'react';
import { useAppContext } from '../../context/AppContext';

const VesselStatus = memo(function VesselStatus() {
    const { state } = useAppContext();
    const ss = state.serverState;

    // Default to fully available if no state
    const cpuAvail = ss ? 100 - ss.cpuLoad : 100;
    const storageAvail = ss ? 100 - ss.storageUsed : 100;
    const ramAvail = ss ? 100 - ss.ramUsed : 100;

    return (
        <div className="glass-panel rounded-xl p-5">
            <div className="mb-4 flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-primary neon-aura-primary"></div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-primary/80">Vessel Status</h3>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                {/* CPU Idle */}
                <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                        <span className="text-white/70">CPU Idle (Warp Core)</span>
                        <span className="text-primary font-mono">{cpuAvail.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/10">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-primary to-secondary neon-aura-primary transition-all duration-500 ease-out"
                            style={{ width: `${Math.max(0, Math.min(100, cpuAvail))}%` }}
                        ></div>
                    </div>
                </div>

                {/* Storage Avail */}
                <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                        <span className="text-white/70">Storage Free (Hull)</span>
                        <span className="text-primary font-mono">{storageAvail.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/10">
                        <div
                            className="h-full rounded-full bg-primary neon-aura-primary transition-all duration-500 ease-out"
                            style={{ width: `${Math.max(0, Math.min(100, storageAvail))}%` }}
                        ></div>
                    </div>
                </div>

                {/* RAM Avail */}
                <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                        <span className="text-white/70">RAM Avail. (Shields)</span>
                        <span className="text-secondary font-mono">{ramAvail.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/10">
                        <div
                            className="h-full rounded-full bg-secondary neon-aura-secondary transition-all duration-500 ease-out"
                            style={{ width: `${Math.max(0, Math.min(100, ramAvail))}%` }}
                        ></div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default VesselStatus;
