const express = require('express');
const cors = require('cors');
const os = require('os');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 8080;
const REPO_DIR = '/app';
const LOG_FILE = '/app/data/logs/updater.log';

if (!fs.existsSync(path.dirname(LOG_FILE))) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

const updateState = {
  inProgress: false,
  phase: 'idle',
  startedAt: null,
  finishedAt: null,
  error: null,
  targetCommit: null,
};

function logBatch(msg) {
  const entry = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, entry);
  } catch (err) {
    console.error('Failed to write updater log:', err.message);
  }
  console.log(msg);
}

function readTailLogs(maxLines = 40) {
  try {
    if (!fs.existsSync(LOG_FILE)) return '';
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split(/\r?\n/);
    return lines.slice(-maxLines).join('\n').trim();
  } catch {
    return '';
  }
}

function execFilePromise(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 20 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        const detail = [stderr, stdout, error.message].filter(Boolean).join('\n').trim();
        reject(new Error(detail || error.message));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function refExists(refName) {
  try {
    await execFilePromise('git', ['show-ref', '--verify', '--quiet', refName], { cwd: REPO_DIR, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function resolveTargetBranch() {
  let branch = '';
  try {
    const { stdout } = await execFilePromise('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: REPO_DIR,
      timeout: 5000,
    });
    branch = stdout.trim();
  } catch {
    branch = '';
  }

  if (!branch || branch === 'HEAD') {
    try {
      const { stdout } = await execFilePromise(
        'git',
        ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
        { cwd: REPO_DIR, timeout: 5000 }
      );
      branch = stdout.trim().replace(/^origin\//, '');
    } catch {
      branch = '';
    }
  }

  if (!branch || !/^[a-zA-Z0-9._/-]+$/.test(branch)) {
    branch = (await refExists('refs/remotes/origin/main')) ? 'main' : 'master';
  }

  if (await refExists(`refs/remotes/origin/${branch}`)) {
    return branch;
  }
  if (await refExists('refs/remotes/origin/main')) {
    return 'main';
  }
  if (await refExists('refs/remotes/origin/master')) {
    return 'master';
  }
  return branch;
}

async function detectComposeContext(dockerEnv) {
  let hostRepoDir = REPO_DIR;
  let composeProject = 'aetheros';
  const hostname = process.env.HOSTNAME || os.hostname();

  if (hostname) {
    try {
      const { stdout } = await execFilePromise(
        'docker',
        ['inspect', hostname, '--format', '{{json .}}'],
        { env: dockerEnv, timeout: 5000 }
      );
      const info = JSON.parse(stdout.trim() || '{}');
      const labels = info.Config?.Labels || {};
      if (labels['com.docker.compose.project']) {
        composeProject = labels['com.docker.compose.project'];
      }
      const appMount = (info.Mounts || []).find((m) => m && m.Destination === REPO_DIR && m.Source);
      if (appMount && appMount.Source) {
        hostRepoDir = appMount.Source;
      }
    } catch (err) {
      logBatch(`Compose context auto-detection fell back to defaults: ${err.message}`);
    }
  }

  return { hostRepoDir, composeProject };
}

app.get('/status', async (req, res) => {
  try {
    const gitExists = fs.existsSync(path.join(REPO_DIR, '.git'));
    if (!gitExists) {
      return res.json({
        status: 'Awaiting Git',
        error: '.git folder not found in /app. Update impossible.',
        gitAvailable: false,
        updateAvailable: false,
        behindCount: 0,
      });
    }

    await execFilePromise('git', ['config', '--global', '--add', 'safe.directory', REPO_DIR], { timeout: 5000 }).catch(() => {});

    const { stdout: headBranchOut } = await execFilePromise('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: REPO_DIR,
      timeout: 5000,
    });
    const { stdout: commitOut } = await execFilePromise('git', ['log', '-1', '--format=%h %s'], {
      cwd: REPO_DIR,
      timeout: 5000,
    });

    // Fetch latest refs quietly with an 8s timeout; ignore network failures when offline
    try {
      await execFilePromise('git', ['fetch', '--quiet', '--prune', 'origin'], { cwd: REPO_DIR, timeout: 8000 });
    } catch { /* ignore network failure */ }

    const headBranch = headBranchOut.trim();
    const targetBranch = await resolveTargetBranch();
    const lastCommit = commitOut.trim();

    let behindCount = 0;
    if (/^[a-zA-Z0-9._/-]+$/.test(targetBranch)) {
      try {
        const { stdout: countOut } = await execFilePromise(
          'git',
          ['rev-list', '--count', `HEAD..origin/${targetBranch}`],
          { cwd: REPO_DIR, timeout: 5000 }
        );
        behindCount = parseInt(countOut.trim(), 10) || 0;
      } catch {
        behindCount = 0;
      }
    }

    res.json({
      branch: headBranch === 'HEAD' ? targetBranch : headBranch,
      targetBranch,
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

app.get('/update-status', (req, res) => {
  res.json({
    ...updateState,
    logs: readTailLogs(40),
  });
});

async function runUpdatePipeline() {
  const dockerEnv = {
    ...process.env,
    DOCKER_HOST: '', // force local unix socket to bypass proxy 403
    DOCKER_BUILDKIT: '0',
    COMPOSE_DOCKER_CLI_BUILD: '0',
  };

  try {
    logBatch('--- SYSTEM UPDATE SEQUENCE STARTING ---');
    logBatch(`Working Directory: ${REPO_DIR}`);
    logBatch(`User: ${process.env.USER || 'root'}`);

    if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
      throw new Error('.git folder not found in /app. Update impossible.');
    }

    await execFilePromise('git', ['config', '--global', '--add', 'safe.directory', REPO_DIR], { timeout: 5000 });

    logBatch('Fetching upstream updates...');
    await execFilePromise('git', ['fetch', '--all', '--prune'], { cwd: REPO_DIR, timeout: 60000 });

    const branch = await resolveTargetBranch();
    logBatch(`Target sync branch: origin/${branch}`);
    await execFilePromise('git', ['reset', '--hard', `origin/${branch}`], { cwd: REPO_DIR, timeout: 15000 });

    const { stdout: commitOut } = await execFilePromise('git', ['log', '-1', '--format=%h %s'], {
      cwd: REPO_DIR,
      timeout: 5000,
    });
    updateState.targetCommit = commitOut.trim();
    logBatch(`Synced to commit: ${updateState.targetCommit}`);

    const { hostRepoDir, composeProject } = await detectComposeContext(dockerEnv);
    logBatch(`Compose project: ${composeProject} | Host project dir: ${hostRepoDir}`);

    const composeBaseArgs = [
      'compose',
      '-p',
      composeProject,
      '--project-directory',
      hostRepoDir,
      '-f',
      path.join(REPO_DIR, 'docker-compose.yml'),
    ];

    updateState.phase = 'building';
    logBatch('Building aetheros-dashboard image while dashboard remains online...');
    const buildRes = await execFilePromise(
      'docker',
      [...composeBaseArgs, 'build', 'aetheros-dashboard'],
      { cwd: REPO_DIR, env: dockerEnv, timeout: 15 * 60 * 1000 }
    );
    if (buildRes.stdout) logBatch(`BUILD STDOUT:\n${buildRes.stdout.trim()}`);
    if (buildRes.stderr) logBatch(`BUILD STDERR:\n${buildRes.stderr.trim()}`);

    updateState.phase = 'restarting';
    logBatch('Checking for legacy conflicting container...');
    try {
      const { stdout: legacyLabelsOut } = await execFilePromise(
        'docker',
        ['inspect', 'aetheros-dashboard', '--format', '{{index .Config.Labels "com.docker.compose.project"}}'],
        { env: dockerEnv, timeout: 5000 }
      );
      if (!legacyLabelsOut.trim()) {
        logBatch('Removing legacy non-Compose aetheros-dashboard container...');
        await execFilePromise('docker', ['rm', '-f', 'aetheros-dashboard'], { env: dockerEnv, timeout: 15000 });
      }
    } catch { /* container absent or already managed by compose */ }

    logBatch('Recreating aetheros-dashboard container...');
    const upRes = await execFilePromise(
      'docker',
      [...composeBaseArgs, 'up', '-d', '--no-deps', '--force-recreate', 'aetheros-dashboard'],
      { cwd: REPO_DIR, env: dockerEnv, timeout: 2 * 60 * 1000 }
    );
    if (upRes.stdout) logBatch(`UP STDOUT:\n${upRes.stdout.trim()}`);
    if (upRes.stderr) logBatch(`UP STDERR:\n${upRes.stderr.trim()}`);

    logBatch('Pruning dangling images...');
    await execFilePromise('docker', ['image', 'prune', '-f'], { env: dockerEnv, timeout: 60000 }).catch(() => {});

    updateState.inProgress = false;
    updateState.phase = 'completed';
    updateState.finishedAt = new Date().toISOString();
    logBatch('--- SYSTEM UPDATE COMPLETED SUCCESSFULLY ---');
  } catch (error) {
    updateState.inProgress = false;
    updateState.phase = 'failed';
    updateState.error = error.message || 'Unknown updater error';
    updateState.finishedAt = new Date().toISOString();
    logBatch(`!!! UPDATE FATAL ERROR: ${updateState.error}`);
  }
}

app.post('/update', (req, res) => {
  if (updateState.inProgress) {
    return res.json({
      status: `Update already in progress (${updateState.phase}).`,
      inProgress: true,
      phase: updateState.phase,
    });
  }

  updateState.inProgress = true;
  updateState.phase = 'fetching';
  updateState.startedAt = new Date().toISOString();
  updateState.finishedAt = null;
  updateState.error = null;
  updateState.targetCommit = null;

  console.log('Update pipeline triggered...');
  res.json({ status: 'Update initiated. Building updated system image...', inProgress: true });

  setTimeout(() => {
    void runUpdatePipeline();
  }, 100);
});

app.listen(PORT, () => {
  console.log(`AetherOS Updater Service listening on port ${PORT}`);
});
