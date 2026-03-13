import { memo } from 'react';
import type { AgentId } from '../../types';

interface AppHeaderProps {
    activeAgent: AgentId;
    setActiveAgent: (id: AgentId) => void;
    onSettingsClick: () => void;
}

const AppHeader = memo(function AppHeader({ activeAgent, setActiveAgent, onSettingsClick }: AppHeaderProps) {
    return (
        <header className="sticky top-0 z-50 flex items-center justify-between border-b border-primary/10 bg-background-dark/80 px-8 py-4 backdrop-blur-md">
            <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20 text-primary neon-aura-primary">
                    <span className="material-symbols-outlined text-2xl">rocket_launch</span>
                </div>
                <div>
                    <h2 className="text-lg font-bold tracking-tight text-slate-100">AetherOS <span className="text-primary/70 font-light">v1.0.4</span></h2>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-primary/50">Utopian Starship Interface</p>
                </div>
            </div>

            <nav className="hidden items-center gap-8 md:flex">
                <button
                    onClick={() => setActiveAgent('nav')}
                    className={`group flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary ${activeAgent === 'nav' ? 'text-primary' : 'text-slate-400'}`}
                >
                    <span className="material-symbols-outlined text-lg">explore</span> Astro-Nav
                </button>
                <button
                    onClick={() => setActiveAgent('security')}
                    className={`group flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary ${activeAgent === 'security' ? 'text-primary' : 'text-slate-400'}`}
                >
                    <span className="material-symbols-outlined text-lg">shield</span> Tactical
                </button>
                <button
                    onClick={() => setActiveAgent('logistics')}
                    className={`group flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary ${activeAgent === 'logistics' ? 'text-primary' : 'text-slate-400'}`}
                >
                    <span className="material-symbols-outlined text-lg">precision_manufacturing</span> Engineering
                </button>
                <button
                    onClick={() => setActiveAgent('comms')}
                    className={`group flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary ${activeAgent === 'comms' ? 'text-primary' : 'text-slate-400'}`}
                >
                    <span className="material-symbols-outlined text-lg">account_tree</span> Systems
                </button>
            </nav>

            <div className="flex items-center gap-4">
                <button className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800/50 text-slate-300 transition-all hover:bg-primary/20 hover:text-primary">
                    <span className="material-symbols-outlined">notifications</span>
                </button>
                <button onClick={onSettingsClick} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800/50 text-slate-300 transition-all hover:bg-primary/20 hover:text-primary">
                    <span className="material-symbols-outlined">settings</span>
                </button>
                <div
                    className="h-10 w-10 rounded-full border-2 border-primary/30 bg-cover bg-center"
                    title="User Profile"
                    style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuCKNHIiX12L_8S1rhQo8_846CqutqFf5qtVyG3iT-SR3HmHJ289FXOychTz5qAM_A0PfOCyhMLdbH4sRzFoWr4j2W38RX0nfeu7bOc2VOMhKonIOxXPqwBs0ugi2rqkFDIShT7zwmCfLCELpUTTXb8j79Lp16K7zUrRMiQnjs1pLrnvypmbkmgbO9-egY6LCGvUu5ZR6eUIR3-E57TaAcr2OS4_3cFbH9xwqO_wjB3--rvy30APB9cjAKFPt1BYQpUJM9yZN1HXUKQg')" }}
                ></div>
            </div>
        </header>
    );
});

export default AppHeader;
