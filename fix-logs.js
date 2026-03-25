import fs from 'fs';

let code = fs.readFileSync('server/agent.js', 'utf8');

const prefix = `import fs from 'fs';
import path from 'path';

const AGENT_LOG_PATH = path.join(process.cwd(), 'data', 'logs', 'agent.log');

function agentLog(...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    console.log(...args);
    try { fs.appendFileSync(AGENT_LOG_PATH, '[' + new Date().toISOString() + '] ' + msg + '\\n'); } catch(e) {}
}

function agentError(...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    console.error(...args);
    try { fs.appendFileSync(AGENT_LOG_PATH, '[' + new Date().toISOString() + '] ERROR: ' + msg + '\\n'); } catch(e) {}
}

`;

code = prefix + code.replace(/console\.log\(/g, 'agentLog(').replace(/console\.error\(/g, 'agentError(');
fs.writeFileSync('server/agent.js', code);
console.log("Done");
