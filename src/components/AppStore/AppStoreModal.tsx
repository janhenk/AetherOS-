import { useState, useEffect } from 'react';
import type { StoreApp } from '../../types';

interface AppStoreModalProps {
    onClose: () => void;
    onDeployed: () => void;
}

export default function AppStoreModal({ onClose, onDeployed }: AppStoreModalProps) {
    const [apps, setApps] = useState<StoreApp[]>([]);
    const [loading, setLoading] = useState(true);
    const [deployingId, setDeployingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [providerUrl, setProviderUrl] = useState('');
    const [addingProvider, setAddingProvider] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showAddProvider, setShowAddProvider] = useState(false);
    const [selectedStore, setSelectedStore] = useState<string>('All');

    // Advanced features
    const [selectedAppDetails, setSelectedAppDetails] = useState<StoreApp | null>(null);
    const [advancedDeployApp, setAdvancedDeployApp] = useState<{ app: StoreApp, composeData: string } | null>(null);
    const [fetchingCompose, setFetchingCompose] = useState(false);

    useEffect(() => {
        const fetchApps = async () => {
            try {
                const res = await fetch('/api/store/apps');
                const data = await res.json();
                if (data.apps) {
                    setApps(data.apps);
                } else {
                    setError(data.error || 'Failed to load apps');
                }
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchApps();
    }, []);

    const handleAddProvider = async () => {
        if (!providerUrl) return;
        setAddingProvider(true);
        setError(null);
        try {
            const res = await fetch('/api/store/provider', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: providerUrl })
            });
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to add provider');
            }
            setProviderUrl('');

            // Refresh apps list
            setLoading(true);
            const appsRes = await fetch('/api/store/apps');
            const appsData = await appsRes.json();
            if (appsData.apps) setApps(appsData.apps);
            else setError(appsData.error);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setAddingProvider(false);
            setLoading(false);
        }
    };

    const handleDeploy = async (app: StoreApp, customComposeData?: string) => {
        setDeployingId(app.id);
        try {
            const bodyData: any = { appPath: app.path };
            if (customComposeData) bodyData.composeData = customComposeData;

            const res = await fetch('/api/store/deploy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bodyData)
            });
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Deployment failed');
            }
            onDeployed();
            onClose();
        } catch (err: any) {
            alert(`Error deploying ${app.title}: ${err.message}`);
        } finally {
            setDeployingId(null);
            setAdvancedDeployApp(null);
        }
    };

    const handleAdvancedDeployInit = async (app: StoreApp) => {
        setFetchingCompose(true);
        try {
            const res = await fetch('/api/store/compose/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appPath: app.path })
            });
            const data = await res.json();
            if (data.composeData) {
                // If details is open, close it to switch to deploy
                setSelectedAppDetails(null);
                setAdvancedDeployApp({ app, composeData: data.composeData });
            } else {
                throw new Error(data.error || 'Failed to fetch compose YAML');
            }
        } catch (err: any) {
            alert(err.message);
        } finally {
            setFetchingCompose(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <div className="glass-panel neon-aura-primary flex max-h-[90vh] w-full max-w-6xl flex-col rounded-2xl overflow-hidden p-0 relative border border-primary/30 outline outline-1 outline-primary/10 shadow-2xl shadow-primary/20">
                <div className="flex items-center justify-between border-b border-primary/20 bg-primary/10 p-5">
                    <div>
                        <h2 className="text-xl font-bold tracking-wider text-primary flex items-center gap-2">
                            <span className="material-symbols-outlined">apps</span>
                            AetherOS App Grid
                        </h2>
                        <p className="text-[10px] text-primary/60 uppercase tracking-widest mt-1">CasaOS Community Store Integration</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-2 text-primary hover:bg-primary/20 transition-colors"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="flex flex-col gap-4 bg-black/40 p-5 border-b border-primary/20">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                        <div className="flex-1 relative">
                            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-primary/50 text-xl">search</span>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search applications by name, category, or developer..."
                                className="w-full bg-primary/10 border border-primary/30 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-200 outline-none focus:border-primary placeholder:text-primary/40 transition-colors"
                            />
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-primary/50 text-base pointer-events-none">filter_list</span>
                                <select
                                    value={selectedStore}
                                    onChange={(e) => setSelectedStore(e.target.value)}
                                    className="appearance-none bg-primary/10 border border-primary/30 rounded-lg pl-9 pr-8 py-2 text-sm text-slate-200 outline-none focus:border-primary cursor-pointer hover:bg-primary/20 transition-all"
                                >
                                    {['All', ...Array.from(new Set(apps.map(a => a.store || 'Unknown')))].map(store => (
                                        <option key={store} value={store} className="bg-slate-900 text-slate-200">
                                            {store === 'All' ? 'All Sources' : store}
                                        </option>
                                    ))}
                                </select>
                                <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/50 text-sm pointer-events-none">expand_more</span>
                            </div>
                            <button
                                onClick={() => setShowAddProvider(!showAddProvider)}
                                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all border ${showAddProvider ? 'bg-primary/40 text-white border-primary shadow-lg shadow-primary/20' : 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20 hover:border-primary/50'}`}
                            >
                                <span className="material-symbols-outlined text-sm">{showAddProvider ? 'close' : 'add'}</span>
                                {showAddProvider ? 'Cancel' : 'Add Store'}
                            </button>
                        </div>
                    </div>

                    {showAddProvider && (
                        <div className="flex items-center gap-3 animate-fade-in border-t border-primary/20 pt-4 mt-2">
                            <input
                                type="text"
                                value={providerUrl}
                                onChange={(e) => setProviderUrl(e.target.value)}
                                placeholder="Paste CasaOS Store .zip URL (e.g. https://casaos-appstore.paodayag.dev/linuxserver.zip)"
                                className="flex-1 bg-black/40 border border-primary/30 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-primary placeholder:text-primary/30"
                                disabled={addingProvider}
                            />
                            <button
                                onClick={handleAddProvider}
                                disabled={addingProvider || !providerUrl.trim()}
                                className="flex items-center gap-2 rounded-lg bg-primary/20 px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary border border-primary/40 hover:bg-primary/40 transition-all disabled:opacity-50"
                            >
                                {addingProvider ? (
                                    <><span className="material-symbols-outlined animate-spin text-sm">sync</span> Adding...</>
                                ) : (
                                    <><span className="material-symbols-outlined text-sm">download</span> Fetch</>
                                )}
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-primary/30 bg-black/20">
                    {loading ? (
                        <div className="flex h-64 flex-col items-center justify-center border border-primary/20 rounded-xl bg-primary/5">
                            <span className="material-symbols-outlined animate-spin text-4xl text-primary mb-4 block">sync</span>
                            <p className="text-sm font-bold text-primary tracking-widest uppercase animate-pulse">Scanning Repositories...</p>
                        </div>
                    ) : error ? (
                        <div className="rounded-xl border border-secondary/30 bg-secondary/10 p-6 text-secondary flex items-start gap-4">
                            <span className="material-symbols-outlined text-3xl">error</span>
                            <div>
                                <h3 className="font-bold tracking-wide mb-1">Store Initialization Failure</h3>
                                <p className="text-sm opacity-80">{error}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                            {apps.filter(app => {
                                const matchesSearch = app.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                    (app.description && app.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
                                    (app.developer && app.developer.toLowerCase().includes(searchQuery.toLowerCase())) ||
                                    (app.category && app.category.toLowerCase().includes(searchQuery.toLowerCase()));
                                const matchesStore = selectedStore === 'All' || app.store === selectedStore;
                                return matchesSearch && matchesStore;
                            }).map((app) => (
                                <div key={app.id} className="relative group flex flex-col rounded-xl border border-primary/20 bg-[#0f172a]/80 p-5 hover:border-primary/50 transition-all hover:bg-primary/10 overflow-hidden shadow-lg shadow-black/50">
                                    <div className="mb-4 flex items-start gap-4">
                                        <img
                                            src={app.icon || 'https://raw.githubusercontent.com/IceWhaleTech/CasaOS-AppStore/main/Apps/AppIcon/default.png'}
                                            alt={app.title}
                                            className="h-14 w-14 rounded-xl object-contain bg-white/10 p-1.5 flex-shrink-0 border border-white/20 shadow-inner"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/IceWhaleTech/CasaOS-AppStore/main/Apps/AppIcon/default.png';
                                            }}
                                        />
                                        <div className="flex-1 min-w-0 pt-1">
                                            <h3 className="truncate text-base font-bold text-slate-100 mb-1 leading-tight">{app.title}</h3>
                                            <p className="text-[10px] text-primary/70 truncate uppercase tracking-widest">{app.developer || app.category || 'Unknown Node'}</p>
                                        </div>
                                    </div>

                                    <p className="text-sm text-slate-400 line-clamp-3 mb-5 flex-1 leading-relaxed">
                                        {app.tagline || app.description || 'No description provided.'}
                                    </p>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setSelectedAppDetails(app)}
                                            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-black/40 p-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-300 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-all hover:border-primary/40"
                                        >
                                            <span className="material-symbols-outlined text-sm">info</span>
                                            Read More
                                        </button>
                                        <button
                                            onClick={() => handleDeploy(app)}
                                            disabled={deployingId === app.id || fetchingCompose}
                                            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary/20 p-2.5 text-[10px] font-bold uppercase tracking-widest text-primary border border-primary/40 hover:bg-primary/40 transition-all disabled:opacity-50 hover:shadow-lg hover:shadow-primary/20"
                                        >
                                            {deployingId === app.id ? (
                                                <><span className="material-symbols-outlined animate-spin text-sm">sync</span> Deploying...</>
                                            ) : (
                                                <><span className="material-symbols-outlined text-sm">download</span> Deploy Node</>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* READ MORE DETAILS MODAL */}
                {selectedAppDetails && (
                    <div className="absolute inset-0 z-10 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center animate-fade-in p-6">
                        <div className="bg-slate-900 border border-primary/30 rounded-2xl p-8 max-w-3xl w-full shadow-2xl relative flex flex-col max-h-full">
                            <button onClick={() => setSelectedAppDetails(null)} className="absolute top-4 right-4 text-primary/60 hover:text-primary p-2">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                            <div className="flex items-start gap-6 mb-6">
                                <img
                                    src={selectedAppDetails.icon || 'https://raw.githubusercontent.com/IceWhaleTech/CasaOS-AppStore/main/Apps/AppIcon/default.png'}
                                    className="h-24 w-24 rounded-2xl object-contain bg-white/10 p-2 shadow-inner border border-primary/20"
                                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/IceWhaleTech/CasaOS-AppStore/main/Apps/AppIcon/default.png'; }}
                                    alt="Icon"
                                />
                                <div className="pt-2 flex-1">
                                    <h2 className="text-3xl font-bold text-white tracking-wide">{selectedAppDetails.title}</h2>
                                    <p className="text-sm font-bold text-primary tracking-widest uppercase mt-1">
                                        {selectedAppDetails.developer || 'Unknown Publisher'} • {selectedAppDetails.category || 'Node App'}
                                    </p>
                                    <p className="text-sm text-slate-300 mt-3 font-medium italic">"{selectedAppDetails.tagline}"</p>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto mb-6 pr-2 scrollbar-thin scrollbar-thumb-primary/30">
                                <h3 className="text-[10px] uppercase font-bold tracking-[0.2em] text-primary/60 mb-2 border-b border-primary/10 pb-1">Full Description</h3>
                                <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                                    {selectedAppDetails.description || 'No extended description available for this application node.'}
                                </p>
                            </div>
                            <div className="flex gap-4">
                                <button
                                    onClick={() => handleAdvancedDeployInit(selectedAppDetails)}
                                    disabled={fetchingCompose}
                                    className="px-6 py-3 rounded-xl border border-primary/50 text-primary font-bold uppercase tracking-widest text-xs hover:bg-primary/20 transition-all flex items-center justify-center gap-2"
                                >
                                    {fetchingCompose ? <span className="material-symbols-outlined animate-spin text-sm">sync</span> : <span className="material-symbols-outlined text-sm">code</span>}
                                    Advanced Configuration
                                </button>
                                <button
                                    onClick={() => handleDeploy(selectedAppDetails)}
                                    disabled={deployingId === selectedAppDetails.id}
                                    className="flex-1 rounded-xl bg-primary text-black font-bold uppercase tracking-widest text-sm hover:bg-emerald-400 transition-all flex items-center justify-center gap-2"
                                >
                                    {deployingId === selectedAppDetails.id ? (
                                        <><span className="material-symbols-outlined animate-spin block">sync</span> Engaging...</>
                                    ) : (
                                        <><span className="material-symbols-outlined block">rocket_launch</span> Express Deploy</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ADVANCED DEPLOY MODAL */}
                {advancedDeployApp && (
                    <div className="absolute inset-0 z-20 bg-black/95 backdrop-blur-xl flex flex-col p-6 animate-fade-in">
                        <div className="flex items-center justify-between border-b border-emerald-500/30 pb-4 mb-4 text-emerald-400">
                            <div>
                                <h2 className="text-xl font-bold tracking-widest flex items-center gap-2">
                                    <span className="material-symbols-outlined">terminal</span>
                                    Advanced Configuration Mode
                                </h2>
                                <p className="text-xs text-emerald-400/60 font-mono mt-1">Editing raw docker-compose.yml for {advancedDeployApp.app.title}</p>
                            </div>
                            <button onClick={() => setAdvancedDeployApp(null)} className="p-2 hover:bg-emerald-500/20 rounded-lg transition-colors">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        <div className="flex-1 flex flex-col gap-2 relative">
                            <textarea
                                value={advancedDeployApp.composeData}
                                onChange={(e) => setAdvancedDeployApp({ ...advancedDeployApp, composeData: e.target.value })}
                                className="flex-1 w-full bg-[#0a0f18] text-emerald-300 font-mono text-sm p-4 rounded-xl border border-emerald-500/30 focus:border-emerald-500 outline-none resize-none scrollbar-thin scrollbar-thumb-emerald-500/30"
                                spellCheck={false}
                            />
                        </div>
                        <div className="flex justify-end gap-4 mt-6">
                            <button
                                onClick={() => handleDeploy(advancedDeployApp.app, advancedDeployApp.composeData)}
                                disabled={deployingId === advancedDeployApp.app.id}
                                className="px-8 py-3 rounded-xl bg-emerald-500 text-black font-bold uppercase tracking-widest text-sm hover:bg-emerald-400 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] flex items-center gap-2"
                            >
                                {deployingId === advancedDeployApp.app.id ? (
                                    <><span className="material-symbols-outlined animate-spin text-lg">sync</span> Applying Config...</>
                                ) : (
                                    <><span className="material-symbols-outlined text-lg">save</span> Save & Deploy Overwrite</>
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
