# AetherOS: Starfleet Server Dashboard

AetherOS is a futuristic, Starfleet-inspired server management dashboard designed for Docker orchestration, real-time telemetry, and AI-driven system control.

## Key Features

> [!TIP]
> **New to AetherOS?** Read the [Comprehensive User Guide](file:///C:/Users/jhede/.gemini/antigravity/brain/9040936d-593c-4b53-b46a-4938ed97decb/AetherOS_User_Guide.md) for a detailed walkthrough of all features with screenshots.

- **Live Telemetry**: Real-time CPU, RAM, Network, and Storage monitoring.
- **Docker Orchestration**: Start, stop, restart, and inspect containers via the LCARS interface.
- **Integrated App Store**: One-click deployment for CasaOS-compatible applications.
- **AI Agent Integration**: Traffic Controller and Network Monitor AI agents with full filesystem access and app store searching.
- **Cross-Platform**: Built to run on Windows and Linux (Ubuntu/Debian).

## Custom ISO Build (Expert)

You can build a "Pre-installed" bootable AetherOS ISO using `simple-cdd`. This MUST be done on a Linux system.

1.  **Enter the OS directory**: `cd os`
2.  **Run the build script**:
    ```bash
    chmod +x build-iso.sh
    ./build-iso.sh
    ```
The script will download the Debian 12 base and package AetherOS into a bootable image located in `iso-build/images/`.

## Quick Start (Fresh Linux Install)

To install AetherOS on a fresh Linux server:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/janhenk/AetherOS-.git
   cd "AetherOS-"
   ```
2. **Run the installer**:
   ```bash
   chmod +x install.sh
   ./install.sh
   ```

## Docker Deployment (Pre-installed)

If you already have Docker and Docker Compose:

```bash
docker-compose up -d
```
The dashboard will be available at `http://localhost:5175`.

## Development Setup

1. **Install dependencies**: `npm install`
2. **Run Dev Overlay (Vite)**: `npm run dev`
3. **Build & Start Production Server**: 
   ```bash
   npm run build
   npm start
   ```

## Configuration

- **API Key**: Enter your Google Gemini API key in the Dashboard Settings (Cog icon) to enable AI agents.
- **Chat History**: Persisted locally in `chat_history.json`.
- **Custom Stores**: Add new CasaOS store URLs in the App Store modal.

---
*Subspace Transmission Ends*
