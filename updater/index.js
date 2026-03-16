const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 8080;

app.post('/update', (req, res) => {
  console.log('Update pipeline triggered...');
  res.json({ status: 'Update initiated. Service will go down briefly for rebuild.' });

  // Disconnect the response before halting the network!
  setTimeout(() => {
    // We are running inside the /app directory structurally mapped from the Host OS.
    // We will exec a git pull, and then command the host's socket proxy to rebuild the aetheros-dashboard container.
    const cmd = `
      cd /app && \\
      git config --global --add safe.directory /app && \\
      git fetch --all && \\
      git reset --hard origin/main && \\
      docker compose build --no-cache aetheros-dashboard && \\
      docker compose up -d aetheros-dashboard
    `;
    
    // We use DOCKER_HOST to route our local compose commands directly to the proxy container
    exec(cmd, { env: { ...process.env, DOCKER_HOST: 'tcp://docker-socket-proxy:2375' } }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Update failed: ${error.message}`);
        return;
      }
      if (stderr) console.error(`stderr: ${stderr}`);
      console.log(`Update completed successfully:\n${stdout}`);
    });
  }, 1000);
});

app.listen(PORT, () => {
    console.log(`AetherOS Updater Service listening on port ${PORT}`);
});
