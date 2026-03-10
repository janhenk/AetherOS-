import { useState } from 'react';
import './App.css';
import { AppProvider, useAppContext } from './context/AppContext';
import AppHeader from './components/AppHeader/AppHeader';
import AppFooter from './components/AppFooter/AppFooter';
import VesselStatus from './components/VesselStatus/VesselStatus';
import CommandLogs from './components/CommandLogs/CommandLogs';
import SectorView from './components/SectorView/SectorView';
import ScenarioSelect from './components/ScenarioSelect/ScenarioSelect';
import SettingsModal from './components/SettingsModal/SettingsModal';
import type { AgentId } from './types';

function AppLayout() {
  const [activeAgent, setActiveAgent] = useState<AgentId>('nav');
  const { state } = useAppContext();

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden">
      <AppHeader
        activeAgent={activeAgent}
        setActiveAgent={setActiveAgent}
        onSettingsClick={() => { }}
      />

      <main className="flex flex-1 flex-col p-6 overflow-hidden">
        {(!state.activeScenario || !state.gameState) ? (
          <ScenarioSelect />
        ) : (
          <div className="flex flex-1 flex-col gap-6 lg:flex-row w-full max-w-screen-3xl mx-auto overflow-hidden">
            <aside className="flex flex-col gap-6 lg:w-[400px] shrink-0 overflow-y-auto pr-1">
              <SectorView />
            </aside>

            <section className="flex flex-1 flex-col min-w-0 gap-6 overflow-hidden">
              <div className="shrink-0">
                <VesselStatus />
              </div>
              <CommandLogs activeAgent={activeAgent} />
            </section>
          </div>
        )}
      </main>

      <AppFooter />

      <SettingsModal />
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <AppLayout />
    </AppProvider>
  );
}

export default App;
