import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../utils/api';
import type { StoreApp } from '../../types';

interface AppStoreModalProps {
    onClose: () => void;
    onDeployed: () => void;
}

const DEFAULT_ICON_URL =
    'https://raw.githubusercontent.com/IceWhaleTech/CasaOS-AppStore/main/Apps/AppIcon/default.png';

export default function AppStoreModal({ onClose, onDeployed }: AppStoreModalProps) {
    const [apps, setApps] = useState<StoreApp[]>([]);
    const [loading, setLoading] = useState(true);
    const [deployingId, setDeployingId] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [statusBanner, setStatusBanner] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

    const [providerUrl, setProviderUrl] = useState('');
    const [addingProvider, setAddingProvider] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showAddProvider, setShowAddProvider] = useState(false);
    const [selectedStore, setSelectedStore] = useState<string>('All');

    const [selectedAppDetails, setSelectedAppDetails] = useState<StoreApp | null>(null);
    const [advancedDeployApp, setAdvancedDeployApp] = useState<{ app: StoreApp; composeData: string } | null>(null);
    const [fetchingCompose, setFetchingCompose] = useState(false);

    const fetchApps = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await apiFetch('/api/store/apps');
            const data = (await res.json()) as { apps?: StoreApp[]; error?: string };
            if (data.apps) {
                setApps(data.apps);
            } else {
                setLoadError(data.error || 'Failed to load application catalog');
            }
        } catch (err: unknown) {
            setLoadError(err instanceof Error ? err.message : 'Failed to load application catalog');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchApps();
    }, [fetchApps]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (advancedDeployApp) {
                setAdvancedDeployApp(null);
            } else if (selectedAppDetails) {
                setSelectedAppDetails(null);
            } else {
                onClose();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [advancedDeployApp, onClose, selectedAppDetails]);

    const handleAddProvider = async () => {
        if (!providerUrl.trim()) return;
        setAddingProvider(true);
        setStatusBanner(null);
        try {
            const res = await apiFetch('/api/store/provider', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: providerUrl.trim() }),
            });
            const data = (await res.json()) as { success?: boolean; error?: string };
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to add store provider');
            }
            setProviderUrl('');
            setShowAddProvider(false);
            setStatusBanner({ type: 'success', message: 'Store repository added and indexed.' });
            await fetchApps();
        } catch (err: unknown) {
            setStatusBanner({
                type: 'error',
                message: err instanceof Error ? err.message : 'Failed to add store provider',
            });
        } finally {
            setAddingProvider(false);
        }
    };

    const handleDeploy = async (app: StoreApp, customComposeData?: string) => {
        setDeployingId(app.id);
        setStatusBanner(null);
        try {
            const bodyData: { appPath: string; composeData?: string } = { appPath: app.path };
            if (customComposeData !== undefined) {
                bodyData.composeData = customComposeData;
            }

            const res = await apiFetch('/api/store/deploy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyData),
            });
            const data = (await res.json()) as { success?: boolean; error?: string };
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Deployment failed');
            }
            setAdvancedDeployApp(null);
            setSelectedAppDetails(null);
            onDeployed();
            onClose();
        } catch (err: unknown) {
            setStatusBanner({
                type: 'error',
                message: `Error deploying ${app.title}: ${err instanceof Error ? err.message : 'Deployment failed'}`,
            });
        } finally {
            setDeployingId(null);
        }
    };

    const handleAdvancedDeployInit = async (app: StoreApp) => {
        setFetchingCompose(true);
        setStatusBanner(null);
        try {
            const res = await apiFetch('/api/store/compose/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appPath: app.path }),
            });
            const data = (await res.json()) as { composeData?: string; error?: string };
            if (!res.ok || !data.composeData) {
                throw new Error(data.error || 'Failed to fetch compose YAML');
            }
            setSelectedAppDetails(null);
            setAdvancedDeployApp({ app, composeData: data.composeData });
        } catch (err: unknown) {
            setStatusBanner({
                type: 'error',
                message: err instanceof Error ? err.message : 'Failed to read compose file',
            });
        } finally {
            setFetchingCompose(false);
        }
    };

    const stores = ['All', ...Array.from(new Set(apps.map((a) => a.store || 'Default')))];
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filteredApps = apps.filter((app) => {
        const matchesSearch =
            !normalizedQuery ||
            app.title.toLowerCase().includes(normalizedQuery) ||
            (app.description && app.description.toLowerCase().includes(normalizedQuery)) ||
            (app.developer && app.developer.toLowerCase().includes(normalizedQuery)) ||
            (app.category && app.category.toLowerCase().includes(normalizedQuery));
        const matchesStore = selectedStore === 'All' || (app.store || 'Default') === selectedStore;
        return matchesSearch && matchesStore;
    });

    return (
        <div
            className="kai-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="App Store"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="kai-modal" style={{ maxWidth: '72rem', height: '88vh' }}>
                {/* Header */}
                <div className="kai-modal-header">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-xl" style={{ color: 'var(--accent-primary)' }}>
                            apps
                        </span>
                        <div>
                            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                Application Catalog
                            </h2>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                CasaOS Community App Store integration
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="kai-btn kai-btn-ghost kai-btn-icon"
                        aria-label="Close app store"
                    >
                        <span className="material-symbols-outlined text-lg">close</span>
                    </button>
                </div>

                {/* Search & Filters Toolbar */}
                <div
                    className="p-4 border-b flex flex-col gap-3 shrink-0"
                    style={{
                        backgroundColor: 'var(--bg-secondary)',
                        borderColor: 'var(--border-subtle)',
                    }}
                >
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <div className="relative flex-1">
                            <span
                                className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-lg pointer-events-none"
                                style={{ color: 'var(--text-muted)' }}
                            >
                                search
                            </span>
                            <input
                                type="text"
                                className="kai-input"
                                style={{ paddingLeft: '2.5rem' }}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search apps by title, category, or developer..."
                                aria-label="Search applications"
                            />
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <select
                                value={selectedStore}
                                onChange={(e) => setSelectedStore(e.target.value)}
                                className="kai-select"
                                style={{ width: 'auto', minWidth: '10rem' }}
                                aria-label="Filter by store source"
                            >
                                {stores.map((store) => (
                                    <option key={store} value={store}>
                                        {store === 'All' ? 'All Sources' : store}
                                    </option>
                                ))}
                            </select>

                            <button
                                type="button"
                                onClick={() => setShowAddProvider((v) => !v)}
                                className={`kai-btn kai-btn-sm ${showAddProvider ? 'kai-btn-primary' : 'kai-btn-secondary'}`}
                            >
                                <span className="material-symbols-outlined text-base">
                                    {showAddProvider ? 'close' : 'add'}
                                </span>
                                <span>{showAddProvider ? 'Cancel' : 'Add Store'}</span>
                            </button>
                        </div>
                    </div>

                    {showAddProvider && (
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                            <input
                                type="url"
                                className="kai-input flex-1"
                                value={providerUrl}
                                onChange={(e) => setProviderUrl(e.target.value)}
                                placeholder="Paste CasaOS Store .zip URL (e.g. https://casaos-appstore.paodayag.dev/linuxserver.zip)"
                                disabled={addingProvider}
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    void handleAddProvider();
                                }}
                                disabled={addingProvider || !providerUrl.trim()}
                                className="kai-btn kai-btn-primary kai-btn-sm shrink-0"
                            >
                                <span className={`material-symbols-outlined text-base ${addingProvider ? 'animate-spin' : ''}`}>
                                    {addingProvider ? 'sync' : 'download'}
                                </span>
                                <span>{addingProvider ? 'Adding...' : 'Fetch Repository'}</span>
                            </button>
                        </div>
                    )}

                    {statusBanner && (
                        <div
                            className={`kai-alert ${statusBanner.type === 'success' ? 'kai-alert-success' : 'kai-alert-error'} flex items-center justify-between gap-2`}
                        >
                            <span className="text-xs">{statusBanner.message}</span>
                            <button
                                type="button"
                                onClick={() => setStatusBanner(null)}
                                className="kai-btn kai-btn-ghost kai-btn-xs"
                                aria-label="Dismiss notification"
                            >
                                <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* Main Content */}
                <div className="kai-modal-body relative">
                    {loading ? (
                        <div className="kai-empty-state flex flex-col items-center justify-center gap-3 py-16">
                            <span
                                className="material-symbols-outlined animate-spin text-3xl"
                                style={{ color: 'var(--accent-primary)' }}
                            >
                                sync
                            </span>
                            <span>Loading application catalog...</span>
                        </div>
                    ) : loadError ? (
                        <div className="kai-alert kai-alert-error flex items-start gap-3">
                            <span className="material-symbols-outlined text-xl shrink-0">error</span>
                            <div>
                                <div className="font-semibold">Failed to Load Store</div>
                                <div className="text-xs mt-1">{loadError}</div>
                            </div>
                        </div>
                    ) : filteredApps.length === 0 ? (
                        <div className="kai-empty-state">
                            No applications match your search criteria.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {filteredApps.map((app) => (
                                <article key={app.id} className="kai-surface-subtle flex flex-col gap-3">
                                    <div className="flex items-start gap-3">
                                        <img
                                            src={app.icon || DEFAULT_ICON_URL}
                                            alt={`${app.title} icon`}
                                            className="h-12 w-12 rounded-lg object-contain p-1 shrink-0 border"
                                            style={{
                                                backgroundColor: 'var(--bg-elevated)',
                                                borderColor: 'var(--border-subtle)',
                                            }}
                                            onError={(e) => {
                                                if (!e.currentTarget.dataset.fallbackApplied) {
                                                    e.currentTarget.dataset.fallbackApplied = '1';
                                                    e.currentTarget.src = DEFAULT_ICON_URL;
                                                }
                                            }}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <h3
                                                className="text-sm font-semibold truncate"
                                                style={{ color: 'var(--text-primary)' }}
                                                title={app.title}
                                            >
                                                {app.title}
                                            </h3>
                                            <p
                                                className="text-xs truncate mt-0.5"
                                                style={{ color: 'var(--text-muted)' }}
                                            >
                                                {app.developer || app.category || 'Community App'}
                                            </p>
                                        </div>
                                    </div>

                                    <p
                                        className="text-xs leading-relaxed line-clamp-3 flex-1"
                                        style={{ color: 'var(--text-secondary)' }}
                                    >
                                        {app.tagline || app.description || 'No description provided.'}
                                    </p>

                                    <div className="flex items-center gap-2 pt-1">
                                        <button
                                            type="button"
                                            onClick={() => setSelectedAppDetails(app)}
                                            className="kai-btn kai-btn-secondary kai-btn-xs flex-1"
                                        >
                                            <span className="material-symbols-outlined text-sm">info</span>
                                            Details
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void handleDeploy(app);
                                            }}
                                            disabled={deployingId === app.id || fetchingCompose}
                                            className="kai-btn kai-btn-primary kai-btn-xs flex-1"
                                        >
                                            <span
                                                className={`material-symbols-outlined text-sm ${deployingId === app.id ? 'animate-spin' : ''}`}
                                            >
                                                {deployingId === app.id ? 'sync' : 'download'}
                                            </span>
                                            {deployingId === app.id ? 'Deploying...' : 'Deploy'}
                                        </button>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}

                    {/* App Details Sub-Dialog */}
                    {selectedAppDetails && (
                        <div
                            className="kai-modal-backdrop"
                            style={{ position: 'absolute', zIndex: 20 }}
                            onClick={(e) => {
                                if (e.target === e.currentTarget) setSelectedAppDetails(null);
                            }}
                        >
                            <div className="kai-modal" style={{ maxWidth: '42rem' }}>
                                <div className="kai-modal-header">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <img
                                            src={selectedAppDetails.icon || DEFAULT_ICON_URL}
                                            alt={`${selectedAppDetails.title} icon`}
                                            className="h-11 w-11 rounded-lg object-contain p-1 border shrink-0"
                                            style={{
                                                backgroundColor: 'var(--bg-elevated)',
                                                borderColor: 'var(--border-subtle)',
                                            }}
                                            onError={(e) => {
                                                if (!e.currentTarget.dataset.fallbackApplied) {
                                                    e.currentTarget.dataset.fallbackApplied = '1';
                                                    e.currentTarget.src = DEFAULT_ICON_URL;
                                                }
                                            }}
                                        />
                                        <div className="min-w-0">
                                            <h3
                                                className="text-base font-semibold truncate"
                                                style={{ color: 'var(--text-primary)' }}
                                            >
                                                {selectedAppDetails.title}
                                            </h3>
                                            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                                                {selectedAppDetails.developer || 'Unknown Publisher'} &bull;{' '}
                                                {selectedAppDetails.category || 'Application'}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedAppDetails(null)}
                                        className="kai-btn kai-btn-ghost kai-btn-icon"
                                        aria-label="Close app details"
                                    >
                                        <span className="material-symbols-outlined text-lg">close</span>
                                    </button>
                                </div>

                                <div className="kai-modal-body flex flex-col gap-3">
                                    {selectedAppDetails.tagline && (
                                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                            {selectedAppDetails.tagline}
                                        </p>
                                    )}
                                    <div
                                        className="text-sm whitespace-pre-wrap leading-relaxed"
                                        style={{ color: 'var(--text-secondary)' }}
                                    >
                                        {selectedAppDetails.description || 'No extended description available.'}
                                    </div>
                                    {selectedAppDetails.port_map && (
                                        <div className="flex items-center gap-2 text-xs">
                                            <span style={{ color: 'var(--text-muted)' }}>Default Port:</span>
                                            <span className="kai-badge kai-mono">{selectedAppDetails.port_map}</span>
                                        </div>
                                    )}
                                </div>

                                <div className="kai-modal-footer justify-between">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void handleAdvancedDeployInit(selectedAppDetails);
                                        }}
                                        disabled={fetchingCompose}
                                        className="kai-btn kai-btn-secondary kai-btn-sm"
                                    >
                                        <span className={`material-symbols-outlined text-base ${fetchingCompose ? 'animate-spin' : ''}`}>
                                            {fetchingCompose ? 'sync' : 'code'}
                                        </span>
                                        Edit Compose YAML
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void handleDeploy(selectedAppDetails);
                                        }}
                                        disabled={deployingId === selectedAppDetails.id}
                                        className="kai-btn kai-btn-primary kai-btn-sm"
                                    >
                                        <span className={`material-symbols-outlined text-base ${deployingId === selectedAppDetails.id ? 'animate-spin' : ''}`}>
                                            {deployingId === selectedAppDetails.id ? 'sync' : 'rocket_launch'}
                                        </span>
                                        {deployingId === selectedAppDetails.id ? 'Deploying...' : 'Deploy Now'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Advanced Compose Editor Sub-Dialog */}
                    {advancedDeployApp && (
                        <div
                            className="kai-modal-backdrop"
                            style={{ position: 'absolute', zIndex: 30 }}
                            onClick={(e) => {
                                if (e.target === e.currentTarget) setAdvancedDeployApp(null);
                            }}
                        >
                            <div className="kai-modal" style={{ maxWidth: '52rem', height: '90%' }}>
                                <div className="kai-modal-header">
                                    <div>
                                        <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                                            Custom Compose Configuration
                                        </h3>
                                        <p className="text-xs kai-mono" style={{ color: 'var(--text-muted)' }}>
                                            docker-compose.yml &bull; {advancedDeployApp.app.title}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setAdvancedDeployApp(null)}
                                        className="kai-btn kai-btn-ghost kai-btn-icon"
                                        aria-label="Close compose editor"
                                    >
                                        <span className="material-symbols-outlined text-lg">close</span>
                                    </button>
                                </div>

                                <div className="kai-modal-body flex flex-col">
                                    <textarea
                                        value={advancedDeployApp.composeData}
                                        onChange={(e) =>
                                            setAdvancedDeployApp({
                                                ...advancedDeployApp,
                                                composeData: e.target.value,
                                            })
                                        }
                                        className="kai-textarea kai-mono flex-1 text-xs leading-relaxed"
                                        style={{ minHeight: '20rem', resize: 'none' }}
                                        spellCheck={false}
                                        aria-label="Docker Compose YAML"
                                    />
                                </div>

                                <div className="kai-modal-footer">
                                    <button
                                        type="button"
                                        onClick={() => setAdvancedDeployApp(null)}
                                        className="kai-btn kai-btn-secondary kai-btn-sm"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void handleDeploy(advancedDeployApp.app, advancedDeployApp.composeData);
                                        }}
                                        disabled={deployingId === advancedDeployApp.app.id}
                                        className="kai-btn kai-btn-primary kai-btn-sm"
                                    >
                                        <span className={`material-symbols-outlined text-base ${deployingId === advancedDeployApp.app.id ? 'animate-spin' : ''}`}>
                                            {deployingId === advancedDeployApp.app.id ? 'sync' : 'save'}
                                        </span>
                                        {deployingId === advancedDeployApp.app.id
                                            ? 'Deploying...'
                                            : 'Save & Deploy'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
