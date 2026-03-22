const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
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

app.get('/status', async (req, res) => {
  try {
    const gitCmd = `cd /app && git config --global --add safe.directory /app && git rev-parse --abbrev-ref HEAD && git log -1 --format="%h %s"`;
    const { stdout } = await execPromise(gitCmd);
    const [branch, lastCommit] = stdout.trim().split('\n');
    res.json({ branch, lastCommit, status: 'Updater online' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      
      const cmd = `
        set -e
        cd /app
        git config --global --add safe.directory /app
        echo "Fetching updates from origin..."
        git fetch --all --prune
        
        BRANCH=$(git rev-parse --abbrev-ref HEAD)
        echo "Synchronizing with origin/$BRANCH..."
        git reset --hard origin/$BRANCH
        
        echo "Initiating dashboard rebuild..."
        docker compose build --no-cache aetheros-dashboard
        
        echo "Restarting core modules..."
        docker compose up -d aetheros-dashboard
      `;

      const { stdout, stderr } = await execPromise(cmd, { env: { ...process.env, DOCKER_HOST: 'tcp://docker-socket-proxy:2375' } });
      
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
