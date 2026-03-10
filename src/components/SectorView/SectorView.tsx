import { memo } from 'react';
import { useAppContext } from '../../context/AppContext';

const SectorView = memo(function SectorView() {
    const { state } = useAppContext();
    const { activeScenario, gameState } = state;

    if (!activeScenario || !gameState) {
        return null;
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="relative overflow-hidden rounded-xl bg-slate-900 min-h-[260px] group flex flex-col shadow-lg">
                <div
                    className="absolute inset-0 z-0 bg-cover bg-center transition-transform duration-1000 group-hover:scale-105 opacity-60"
                    style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuD6bA-SkBGBbipJbrOkV4CYIX82VKeiPPZs4jVW3V5lWCmJq2tJjj2E3KmG_jcFb9pJ7yRtEGDazEmbB6wvVsEFL2AjP1QP55-QGidDR3gUrOkZVFxQkr9Um52gzaXMxqqLxJc7uPBefHawwb7Xy4BzpFqWSFSMShoAPw-_oHdIgBd49Sm1VOoZRw5AQexfqHc4sAi1rkGydCRE_iNKj2TEMaELpdv2GsmdiUDgfgwLawRP51lzOkxKRkGEBmVzyqmS3iypS9LSNpk7')" }}
                ></div>
                <div className="absolute inset-0 z-10 bg-gradient-to-t from-background-dark via-background-dark/40 to-transparent"></div>
                <div className="absolute inset-0 z-20 flex flex-col justify-between p-6">
                    <div className="flex flex-col gap-3">
                        <div className="glass-panel rounded-lg px-4 py-2 border-primary/20 backdrop-blur-md self-start">
                            <p className="text-[10px] uppercase tracking-widest text-primary">Current Sector</p>
                            <h2 className="text-xl font-bold text-white tracking-wide">{gameState.location}</h2>
                        </div>
                    </div>

                    <div className="flex items-end justify-between mt-auto">
                        <div className="flex gap-6">
                            <div>
                                <p className="text-[9px] uppercase tracking-[0.2em] text-slate-300">Velocity</p>
                                <p className="text-xl font-bold text-white drop-shadow-md">0.92 <span className="text-xs font-light text-primary">c</span></p>
                            </div>
                            <div>
                                <p className="text-[9px] uppercase tracking-[0.2em] text-slate-300">Heading</p>
                                <p className="text-xl font-bold text-white drop-shadow-md">284.15&deg;</p>
                            </div>
                        </div>
                        <div className="h-10 w-10 flex items-center justify-center rounded-full border border-primary/40 bg-primary/20 neon-aura-primary backdrop-blur-md">
                            <span className="material-symbols-outlined text-primary text-xl">filter_center_focus</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="glass-panel rounded-xl p-5">
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-bold text-white tracking-wide">Mission Objective</h3>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest">{activeScenario.title}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-xs font-bold text-primary capitalize tracking-widest">{gameState.missionStatus}</p>
                    </div>
                </div>

                <div className="relative border border-primary/20 rounded-lg p-3 bg-primary/5">
                    <div className="text-xs text-slate-300 font-mono leading-relaxed line-clamp-4">
                        {activeScenario.description}
                    </div>
                </div>
            </div>

            <div className="glass-panel rounded-xl p-5 flex flex-col justify-between">
                <div>
                    <h3 className="text-sm font-bold text-white mb-1 tracking-wide">Quick Actions</h3>
                    <p className="text-[10px] text-slate-400 mb-4 uppercase tracking-widest">Automated Bridge Sequences</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <button className="flex items-center gap-2 rounded-lg border border-primary/10 bg-primary/5 p-2 transition-all hover:bg-primary/20 group">
                        <span className="material-symbols-outlined text-primary text-sm">auto_fix_high</span>
                        <span className="text-[10px] font-bold tracking-wider text-slate-200 uppercase">Auto-Repair</span>
                    </button>
                    <button className="flex items-center gap-2 rounded-lg border border-primary/10 bg-primary/5 p-2 transition-all hover:bg-primary/20">
                        <span className="material-symbols-outlined text-primary text-sm">wifi_channel</span>
                        <span className="text-[10px] font-bold tracking-wider text-slate-200 uppercase">Comm-Burst</span>
                    </button>
                    <button className="flex items-center gap-2 rounded-lg border border-primary/10 bg-primary/5 p-2 transition-all hover:bg-primary/20">
                        <span className="material-symbols-outlined text-primary text-sm">travel_explore</span>
                        <span className="text-[10px] font-bold tracking-wider text-slate-200 uppercase">Initiate Scan</span>
                    </button>
                    <button className="flex items-center gap-2 rounded-lg border border-secondary/10 bg-secondary/5 p-2 transition-all hover:bg-secondary/20 hover:neon-aura-secondary">
                        <span className="material-symbols-outlined text-secondary text-sm">emergency</span>
                        <span className="text-[10px] font-bold tracking-wider text-slate-200 uppercase">Evasive AI</span>
                    </button>
                </div>
            </div>
        </div>
    );
});

export default SectorView;
