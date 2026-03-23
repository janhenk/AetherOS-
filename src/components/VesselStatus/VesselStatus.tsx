import { memo, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAppContext } from '../../context/AppContext';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler,
    type ChartOptions
} from 'chart.js';
import { Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Filler,
    Title,
    Tooltip,
    Legend
);

const VesselStatus = memo(function VesselStatus() {
    const { state } = useAppContext();
    const [activeChart, setActiveChart] = useState<'cpu' | 'ram' | 'storage' | null>(null);
    const ss = state.serverState;

    // Default to fully available if no state
    const cpuAvail = ss ? 100 - ss.cpuLoad : 100;
    const ramAvail = ss ? 100 - ss.ramUsed : 100;
    
    const storageInfo = useMemo(() => {
        if (!ss || !ss.storageUsed) return { aggregate: 100, disks: [] };
        if (typeof ss.storageUsed === 'number') {
            return { aggregate: 100 - ss.storageUsed, disks: [] };
        }
        return { 
            aggregate: 100 - ss.storageUsed.aggregatePercent, 
            disks: ss.storageUsed.disks 
        };
    }, [ss]);

    const storageAvail = storageInfo.aggregate;

    const chartData = useMemo(() => {
        if (!activeChart) return null;
        
        // Data points (Availability %: 100 - Load)
        const data = state.statsHistory.map(p => activeChart === 'cpu' ? (100 - p.cpu) : (100 - p.ram));
        
        // Labels (Timeframe: 0 to 600s ago)
        const labels = state.statsHistory.map((_, i) => `${state.statsHistory.length - 1 - i}s`).reverse();
        
        const color = activeChart === 'cpu' ? '#bbb891' : '#d6a89c'; // Gold for CPU, Rose for RAM
        const secondaryColor = activeChart === 'cpu' ? 'rgba(187, 184, 145, 0.1)' : 'rgba(214, 168, 156, 0.1)';

        return {
            labels,
            datasets: [
                {
                    label: activeChart === 'cpu' ? 'CPU Availability' : 'RAM Availability',
                    data,
                    borderColor: color,
                    backgroundColor: secondaryColor,
                    tension: 0.1, // Reduced smoothing for precision
                    fill: true,
                    pointRadius: 0,
                    borderWidth: 2,
                },
            ],
        };
    }, [state.statsHistory, activeChart]);

    const chartOptions: ChartOptions<'line'> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
                titleColor: activeChart === 'cpu' ? '#bbb891' : '#d6a89c',
                bodyColor: '#fff',
                borderColor: activeChart === 'cpu' ? 'rgba(187, 184, 145, 0.3)' : 'rgba(214, 168, 156, 0.3)',
                borderWidth: 1,
            },
        },
        scales: {
            x: {
                display: true,
                grid: { display: false },
                ticks: { 
                    color: 'rgba(187, 184, 145, 0.5)', 
                    maxRotation: 0, 
                    autoSkip: true, 
                    maxTicksLimit: 8,
                    font: { size: 9 }
                }
            },
            y: {
                display: true,
                min: 0,
                max: 100,
                grid: { color: 'rgba(187, 184, 145, 0.1)' },
                ticks: { color: 'rgba(187, 184, 145, 0.5)', callback: (val) => `${val}%`, font: { size: 9 } }
            },
        },
    };

    const modalContent = activeChart && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-300">
            <div className="glass-panel w-full max-w-3xl rounded-2xl p-6 border border-primary/20 shadow-2xl animate-in zoom-in-95 duration-300">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-3">
                        <div className={`h-3 w-3 rounded-full ${activeChart === 'cpu' ? 'bg-primary' : 'bg-secondary'} animate-pulse`}></div>
                        <h2 className="text-lg font-bold uppercase tracking-widest text-white/90">
                            {activeChart === 'cpu' ? 'Main Warp Core (CPU)' : 
                             activeChart === 'ram' ? 'Structural Shields (RAM)' : 
                             'Hull Integrity (Storage)'} Telemetry
                        </h2>
                    </div>
                    <button 
                        onClick={() => setActiveChart(null)}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                    >
                        <span className="material-symbols-outlined text-lg">close</span>
                    </button>
                </div>

                <div className="h-[400px] w-full bg-black/40 rounded-xl p-4 border border-white/5 shadow-inner overflow-y-auto">
                    {activeChart === 'storage' ? (
                        <div className="space-y-6 p-2">
                            {storageInfo.disks.length > 0 ? (
                                storageInfo.disks.map((disk, i) => (
                                    <div key={i} className="space-y-2 animate-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: `${i * 50}ms` }}>
                                        <div className="flex justify-between items-end">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-primary/60 font-bold uppercase tracking-tighter">{disk.device}</span>
                                                <span className="text-sm font-bold text-white/90">{disk.mount}</span>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-xs font-mono text-primary">{disk.percent}% Used</div>
                                                <div className="text-[10px] text-white/30 uppercase">
                                                    {(disk.used / (1024**3)).toFixed(1)}GB / {(disk.total / (1024**3)).toFixed(1)}GB
                                                </div>
                                            </div>
                                        </div>
                                        <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden ring-1 ring-white/5">
                                            <div
                                                className={`h-full rounded-full transition-all duration-1000 ease-out ${disk.percent > 90 ? 'bg-red-500 neon-aura-red' : disk.percent > 70 ? 'bg-orange-500' : 'bg-primary neon-aura-primary'}`}
                                                style={{ width: `${disk.percent}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="flex items-center justify-center h-full text-white/30 uppercase tracking-widest text-xs">
                                    No detailed telemetry available for sub-sectors
                                </div>
                            )}
                        </div>
                    ) : (
                        chartData && <Line options={chartOptions} data={chartData} />
                    )}
                </div>

                <div className="mt-6 flex justify-between items-center text-[10px] text-white/40 uppercase tracking-widest font-bold">
                    <div>
                        {activeChart === 'storage' 
                            ? `Total Secondary Sectors: ${storageInfo.disks.length}` 
                            : 'Telemetry Window: 10m Sliding Buffer (Real-time)'}
                    </div>
                    <div className="flex gap-4">
                        <div className="flex items-center gap-1.5">
                            <div className={`h-1.5 w-1.5 rounded-full ${activeChart === 'storage' ? 'bg-primary' : 'bg-primary'}`}></div> 
                            {activeChart === 'storage' ? 'USED CAPACITY' : 'AVAILABLE'}
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="h-1.5 w-1.5 rounded-full bg-white/10"></div> TOTAL CAPACITY
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="glass-panel rounded-xl p-5 relative overflow-hidden">
            <div className="mb-4 flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-primary neon-aura-primary"></div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-primary/80">Vessel Status</h3>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                {/* CPU Idle */}
                <div 
                    className="space-y-2 cursor-pointer group hover:opacity-80 transition-opacity"
                    onClick={() => setActiveChart('cpu')}
                >
                    <div className="flex justify-between text-xs">
                        <span className="text-white/70 group-hover:text-primary transition-colors">CPU Idle (Warp Core)</span>
                        <span className="text-primary font-mono">{cpuAvail.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden ring-1 ring-white/5">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-primary to-secondary neon-aura-primary transition-all duration-500 ease-out"
                            style={{ width: `${Math.max(0, Math.min(100, cpuAvail))}%` }}
                        ></div>
                    </div>
                </div>

                {/* Storage Avail */}
                <div 
                    className="space-y-2 cursor-pointer group hover:opacity-80 transition-opacity"
                    onClick={() => setActiveChart('storage')}
                >
                    <div className="flex justify-between text-xs">
                        <span className="text-white/70 group-hover:text-primary transition-colors">Storage Free (Hull)</span>
                        <span className="text-primary font-mono">{storageAvail.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden ring-1 ring-white/5">
                        <div
                            className="h-full rounded-full bg-primary neon-aura-primary transition-all duration-500 ease-out"
                            style={{ width: `${Math.max(0, Math.min(100, storageAvail))}%` }}
                        ></div>
                    </div>
                </div>

                {/* RAM Avail */}
                <div 
                    className="space-y-2 cursor-pointer group hover:opacity-80 transition-opacity"
                    onClick={() => setActiveChart('ram')}
                >
                    <div className="flex justify-between text-xs">
                        <span className="text-white/70 group-hover:text-secondary transition-colors">RAM Avail. (Shields)</span>
                        <span className="text-secondary font-mono">{ramAvail.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden ring-1 ring-white/5">
                        <div
                            className="h-full rounded-full bg-secondary neon-aura-secondary transition-all duration-500 ease-out"
                            style={{ width: `${Math.max(0, Math.min(100, ramAvail))}%` }}
                        ></div>
                    </div>
                </div>
            </div>

            {/* Visual Header Decoration */}
            <div className="absolute top-0 right-0 w-32 h-1 bg-gradient-to-l from-primary/30 to-transparent"></div>
            <div className="absolute bottom-0 left-0 w-32 h-1 bg-gradient-to-r from-secondary/30 to-transparent"></div>

            {/* Optimization Overlay (Chart Modal) - Rendered via Portal */}
            {activeChart && createPortal(modalContent, document.body)}
        </div>
    );
});

export default VesselStatus;
