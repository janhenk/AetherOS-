# AetherOS: Developmental Breakdown & Technical Documentation

## 1. Project Mission & Overview
**AetherOS** is a high-fidelity, LCARS-inspired starship interface and system management platform. It serves as a unified command center for managing Docker-based infrastructure with integrated AI agents capable of autonomous system diagnostics, network intelligence, and automated maintenance.

### Core Goals
- **Unified Command**: Centralize Docker and host management into a single futuristic interface.
- **Agentic Autonomy**: Empower AI agents with real tools (Filesystem, Docker, Web) to solve technical issues without manual intervention.
- **Premium Aesthetics**: Deliver a high-quality, responsive LCARS theme that feels like a starship console.
- **Mobile-First Security**: Securely proxy sensitive AI operations to allow full system control from mobile devices.

---

## 2. Technical Stack
- **Frontend**: 
    - **React 19**: Modern component-based architecture.
    - **Vite**: Ultra-fast build tool and development server.
    - **TailwindCSS**: Utility-first styling with custom CSS variable mapping for dynamic theming.
    - **Lucide & Material Symbols**: High-fidelity iconography.
- **Backend**:
    - **Express (Node.js)**: Lightweight server for API routing and tool execution.
    - **Google Gemini API**: Powering the multi-agent LLM logic via function calling.
- **Infrastructure**:
    - **Docker / Docker Compose**: Native support for container orchestration.
    - **Git Integration**: Automated updates and version tracking.

---

## 3. Core Architecture
### A. State Management (AppContext)
AetherOS uses a centralized React Context with a `useReducer` pattern to manage:
- **data/**: Centralized persistent storage (volume-mapped) for:
    - `data/chat_history.json`
    - `data/settings.json`
    - `data/stores.json`
    - `data/auth_keys.json`
    - `data/logs/` (audit logs)
- **aetheros/**: Localized workspace and temporary processing structures.
- **YOLO Mode**: A global "Incursion Alert" state that dynamically shifts theme colors across the entire application.

### B. AI Agent Framework
The system uses a partitioned multi-agent approach defined in `src/agents.ts`:
- **ROUTER-AI (Traffic Controller)**: Manages load balancing, container health, and host OS updates.
- **NET-AI (Network Monitor)**: Handles web intelligence, Google searches, and web scraping.
- **DB-OPS**: Specialized in storage clusters and database migrations.
- **AUTH-SYS**: Manages firewall integrity and access control.

### C. Tool-Calling Workflow
1. **Frontend Request**: User sends a message via `CommandLogs.tsx`.
2. **Hook Intervention**: `useGemini.ts` processes the message and checks for tool suggestions from Gemini.
3. **Internal Processing**: If a tool is suggested, the system verifies `pendingApproval`.
4. **Backend Execution**: Secure proxy in `server/index.js` executes the actual system command (e.g., `docker stats`).
5. **Feedback Loop**: Output is returned to the agent, which synthesizes a response.

---

## 4. Key Features
### Advanced Docker Management
- **Dashboard Visibility**: Real-time stats, uptime, and status indicators.
- **Compose Deployment**: Native support for multi-container apps via `/api/docker/compose-deploy`.
- **Granular Control**: Start, stop, restart, and force-remove actions with real-time feedback.
- **AI Diagnostics**: Dedicated "Diagnose" buttons that trigger targeted agent investigative loops.

### Subspace Terminal
- A web-based terminal emulator providing direct command-line access to the host, sandboxed for security.

### AetherOS App Store
- A curated marketplace for deploying pre-configured Docker templates (e.g., Portainer, Grafana) directly into the environment.

### Automated Updater
- A git-integrated system that performs `git fetch` to detect updates.
- Features a staged, 4-step update sequence (Sync -> Pull -> Rebuild -> Reboot) with elegant visual feedback.

---

## 5. Security & Operations
- **Server-Side Secrets**: All API keys are stored in `server/settings.json`, never exposed to the frontend.
- **Path Shielding**: Backend APIs include `isPathSafe` checks to prevent directory traversal.
- **YOLO Mode (Incursion Alert)**: A sophisticated theme override that uses CSS variables for minimal performance overhead and maximum visual impact.
- **Git Hygiene**: System data files (`chat_history.json`, etc.) are untracked via `.gitignore` and `git rm --cached` to prevent deployment merge conflicts.

---

## 6. Developer Guidelines
- **Adding Tools**: Register new methods in `src/hooks/useGemini.ts` and implement the corresponding handler in `server/index.js`.
- **Theme Adjustments**: Use CSS variables in `index.css` to ensure components respond to YOLO mode transitions.
- **Persistence**: Any state intended to survive reloads should be added to the server-side sync loop in `AppContext.tsx`.
