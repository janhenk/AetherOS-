import './App.css';
import { AppProvider } from './context/AppContext';
import AppHeader from './components/AppHeader/AppHeader';
import AppFooter from './components/AppFooter/AppFooter';
import VesselStatus from './components/VesselStatus/VesselStatus';
import CommandLogs from './components/CommandLogs/CommandLogs';
import SectorView from './components/SectorView/SectorView';
import SettingsModal from './components/SettingsModal/SettingsModal';
import LogViewerModal from './components/LogViewer/LogViewerModal';
import { AuthOverlay } from './components/Auth/AuthOverlay';
import { useState, useEffect } from 'react';
import { useAppContext } from './context/AppContext';

function AppLayout() {
  const { state, dispatch } = useAppContext();
  const activeAgent = state.activeAgent;

  return (
    <div className={`relative flex min-h-[100dvh] lg:h-[100dvh] w-full flex-col overflow-y-auto lg:overflow-hidden transition-colors duration-700 ${state.isYoloMode ? 'incursion-alert' : ''}`}>
      <AppHeader
        activeAgent={activeAgent}
        setActiveAgent={(id) => dispatch({ type: 'SELECT_AGENT', payload: id })}
        onSettingsClick={() => dispatch({ type: 'TOGGLE_SETTINGS' })}
      />

      <main className="flex flex-1 flex-col p-4 lg:p-6 overflow-y-auto lg:overflow-hidden">
        <div className="flex flex-1 flex-col gap-6 lg:flex-row w-full max-w-screen-3xl mx-auto lg:overflow-hidden">
          <aside className="flex flex-col gap-6 lg:w-[400px] shrink-0 lg:overflow-y-auto pr-0 lg:pr-1">
            <SectorView />
          </aside>

          <section className="flex flex-1 flex-col min-w-0 gap-6 lg:overflow-hidden min-h-[500px] lg:min-h-0">
            <div className="shrink-0">
              <VesselStatus />
            </div>
            <CommandLogs activeAgent={activeAgent} />
          </section>
        </div>
      </main>

      <AppFooter />

      <SettingsModal />
      <LogViewerModal />
    </div>
  );
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!localStorage.getItem('aetheros_token'));

  useEffect(() => {
    const handleUnauthorized = () => {
      console.warn('Unauthorized access detected. Redirecting to login...');
      localStorage.removeItem('aetheros_token');
      setIsAuthenticated(false);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  return (
    <>
      {!isAuthenticated && <AuthOverlay onAuthenticated={() => setIsAuthenticated(true)} />}
      {isAuthenticated && (
        <AppProvider>
          <AppLayout />
        </AppProvider>
      )}
    </>
  );
}

export default App;
