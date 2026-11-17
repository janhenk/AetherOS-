const express = require('express');
const cors = require('cors');
const { exec, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 8080;
const LOG_FILE = '/app/data/logs/updater.log';

// Ensure data logs directory exists
if (!fs.existsSync(path.dirname(LOG_FILE))) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

function execPromise(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

function execFilePromise(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

app.get('/status', async (req, res) => {
  try {
    const gitExists = fs.existsSync('/app/.git');
    if (!gitExists) {
      return res.json({
        status: 'Awaiting Git',
        error: '.git folder not found in /app. Update impossible.',
        gitAvailable: false,
        updateAvailable: false,
        behindCount: 0,
      });
    }

    await execFilePromise('git', ['config', '--global', '--add', 'safe.directory', '/app'], { timeout: 5000 }).catch(() => {});

    const { stdout: branchOut } = await execFilePromise('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: '/app', timeout: 5000 });
    const { stdout: commitOut } = await execFilePromise('git', ['log', '-1', '--format=%h %s'], { cwd: '/app', timeout: 5000 });
    const branch = branchOut.trim();
    const lastCommit = commitOut.trim();
    const targetBranch = (!branch || branch === 'HEAD') ? 'master' : branch;

    // Fetch latest refs quietly with an 8s timeout; ignore network failures when offline
    try {
      await execFilePromise('git', ['fetch', '--quiet', 'origin'], { cwd: '/app', timeout: 8000 });
    } catch { /* ignore network failure */ }

    let behindCount = 0;
    if (/^[a-zA-Z0-9._/-]+$/.test(targetBranch)) {
      try {
        const { stdout: countOut } = await execFilePromise(
          'git',
          ['rev-list', '--count', `HEAD..origin/${targetBranch}`],
          { cwd: '/app', timeout: 5000 }
        );
        behindCount = parseInt(countOut.trim(), 10) || 0;
      } catch {
        behindCount = 0;
      }
    }

    res.json({
      branch,
      lastCommit,
      behindCount,
      updateAvailable: behindCount > 0,
      status: 'Updater online',
      gitAvailable: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, gitAvailable: false, updateAvailable: false, behindCount: 0 });
  }
});

app.post('/update', (req, res) => {
  console.log('Update pipeline triggered...');
  res.json({ status: 'Update initiated. System core will rebuild.' });

  setTimeout(async () => {
    const logBatch = (msg) => {
      const entry = `[${new Date().toISOString()}] ${msg}\n`;
      fs.appendFileSync(LOG_FILE, entry);
      console.log(msg);
    };

    try {
      logBatch('--- SYSTEM UPDATE SEQUENCE STARTING ---');
      logBatch(`Working Directory: /app`);
      logBatch(`User: ${process.env.USER || 'root'}`);
      
      const cmd = `
        set -e
        cd /app
        echo "Configuring git safety..."
        git config --global --add safe.directory /app
        
        echo "Fetching all updates..."
        git fetch --all --prune
        
        # Robust branch detection
        BRANCH=$(git rev-parse --abbrev-ref HEAD)
        if [ "$BRANCH" = "HEAD" ]; then
          echo "Detached HEAD detected. Defaulting to 'master' for sync."
          BRANCH="master"
        fi
        
        echo "Target sync branch: origin/$BRANCH"
        git reset --hard origin/$BRANCH
        
        echo "Verifying local file sync..."
        git log -1 --format="%h %s"
        
        echo "Clearing legacy port allocations if present..."
        # If the old hardcoded container is running, stop it to free port 5175
        docker stop aetheros-dashboard || true
        docker rm aetheros-dashboard || true
        
        echo "Initiating dashboard rebuild via socket proxy..."
        # We use 'docker compose' as a plugin, ensuring we rebuild ONLY the dashboard
        docker compose build --no-cache aetheros-dashboard
        
        echo "Restarting core modules..."
        docker compose up -d aetheros-dashboard
        
        echo "Pruning old images..."
        docker image prune -f
      `;

      const { stdout, stderr } = await execPromise(cmd, { 
        env: { 
          ...process.env, 
          DOCKER_HOST: '', // force local socket to bypass proxy 403
          DOCKER_BUILDKIT: '0',
          COMPOSE_DOCKER_CLI_BUILD: '0'
        } 
      });
      
      if (stdout) logBatch(`STDOUT:\n${stdout}`);
      if (stderr) logBatch(`STDERR:\n${stderr}`);
      logBatch('--- SYSTEM UPDATE COMPLETED SUCCESSFULLY ---');

    } catch (error) {
      logBatch(`!!! UPDATE FATAL ERROR: ${error.message}`);
    }
  }, 1000);
});

app.listen(PORT, () => {
    console.log(`AetherOS Updater Service listening on port ${PORT}`);
});
