#!/usr/bin/env node
// =============================================================================
// MCP Supergateway Hub
// =============================================================================
// Launches multiple MCP stdio servers, each wrapped in a supergateway instance
// exposing streamableHttp on sequential ports.
//
// Usage:
//   node index.js                    # Start all servers
//   node index.js --only github,git  # Start specific servers
//   node index.js --exclude blender  # Start all except listed
//   node index.js --list             # List all available servers
//   node index.js --generate         # Generate Claude Code settings.json
// =============================================================================

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { getServers } from './servers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '..', '.env');

// Load .env manually
if (existsSync(ENV_PATH)) {
  const envContent = readFileSync(ENV_PATH, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const HOST = process.env.MCP_HOST || '0.0.0.0';
const BASE_PORT = parseInt(process.env.MCP_BASE_PORT || '3170', 10);
const PUBLIC_HOST = process.env.MCP_PUBLIC_HOST || '192.168.1.7';

// Parse CLI args
const args = process.argv.slice(2);
const flagIdx = (flag) => args.indexOf(flag);

if (args.includes('--list')) {
  const servers = getServers();
  console.log(`\nAvailable MCP servers (${servers.length}):\n`);
  servers.forEach((s, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${s.name.padEnd(22)} ${s.command} ${s.args.join(' ')}`);
  });
  process.exit(0);
}

if (args.includes('--generate')) {
  generateSettings();
  process.exit(0);
}

// Filter servers
let servers = getServers();
const onlyIdx = flagIdx('--only');
const excludeIdx = flagIdx('--exclude');

if (onlyIdx !== -1 && args[onlyIdx + 1]) {
  const only = new Set(args[onlyIdx + 1].split(','));
  servers = servers.filter(s => only.has(s.name));
}
if (excludeIdx !== -1 && args[excludeIdx + 1]) {
  const exclude = new Set(args[excludeIdx + 1].split(','));
  servers = servers.filter(s => !exclude.has(s.name));
}

// Launch
const running = [];
const failed = [];

async function launchServer(server, port) {
  const stdioCmdParts = [server.command, ...server.args];
  const stdioCmd = stdioCmdParts.join(' ');

  const sgBin = resolve(__dirname, 'node_modules', '.bin', 'supergateway');
  const sgArgs = [
    '--stdio', stdioCmd,
    '--outputTransport', 'streamableHttp',
    '--port', String(port),
    '--cors',
    '--logLevel', 'none',
    '--healthEndpoint', '/health',
  ];

  // Build environment: inherit process.env + server-specific env
  const childEnv = { ...process.env };
  if (server.env) {
    for (const [k, v] of Object.entries(server.env)) {
      if (v !== undefined && v !== null) {
        childEnv[k] = String(v);
      }
    }
  }

  return new Promise((resolve) => {
    const child = spawn(sgBin, sgArgs, {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        started = true;
        // Assume it's running if it hasn't crashed
        running.push({ name: server.name, port, pid: child.pid });
        resolve(true);
      }
    }, 5000);

    child.on('error', (err) => {
      if (!started) {
        started = true;
        clearTimeout(timeout);
        failed.push({ name: server.name, error: err.message });
        resolve(false);
      }
    });

    child.on('exit', (code) => {
      if (!started) {
        started = true;
        clearTimeout(timeout);
        if (code !== 0) {
          const errMsg = stderrBuf.trim() ? `exit code ${code}: ${stderrBuf.trim().split('\n').slice(-3).join(' | ')}` : `exit code ${code}`;
          failed.push({ name: server.name, error: errMsg });
          resolve(false);
        }
      } else {
        // Server died after starting
        console.error(`[DIED] ${server.name} (port ${port}) exited with code ${code}`);
        if (stderrBuf.trim()) {
          console.error(`[DIED] ${server.name} stderr:\n${stderrBuf.trim().split('\n').slice(-10).join('\n')}`);
        }
      }
    });

    // Check stderr for quick failures
    let stderrBuf = '';
    child.stderr.on('data', (data) => {
      stderrBuf += data.toString();
    });
  });
}

async function main() {
  console.log('');
  console.log('==============================================');
  console.log('  MCP Supergateway Hub');
  console.log('==============================================');
  console.log(`  Launching ${servers.length} servers on ports ${BASE_PORT}-${BASE_PORT + servers.length - 1}`);
  console.log('');

  // Launch in batches to avoid overwhelming the system
  const BATCH_SIZE = 10;
  for (let i = 0; i < servers.length; i += BATCH_SIZE) {
    const batch = servers.slice(i, i + BATCH_SIZE);
    const promises = batch.map((server, j) => {
      const port = BASE_PORT + i + j;
      return launchServer(server, port);
    });
    await Promise.all(promises);

    // Print batch progress
    for (const server of batch) {
      const r = running.find(x => x.name === server.name);
      const f = failed.find(x => x.name === server.name);
      if (r) {
        console.log(`  [OK] ${server.name.padEnd(22)} -> port ${r.port}`);
      } else if (f) {
        console.log(`  [XX] ${server.name.padEnd(22)} -> ${f.error}`);
      }
    }
  }

  console.log('');
  console.log('==============================================');
  console.log(`  Started: ${running.length}/${servers.length}`);
  if (failed.length > 0) {
    console.log(`  Failed:  ${failed.length}`);
  }
  console.log('==============================================');
  console.log('');

  // Generate settings
  generateSettings(running);

  console.log('Press Ctrl+C to stop all servers.');
  console.log('');
}

function generateSettings(activeServers) {
  const servers = activeServers || getServers().map((s, i) => ({
    name: s.name,
    port: BASE_PORT + i,
  }));

  const mcpServers = {};
  for (const s of servers) {
    mcpServers[s.name] = {
      url: `http://${PUBLIC_HOST}:${s.port}/mcp`,
    };
  }

  const settings = { mcpServers };
  const outPath = resolve(__dirname, 'claude-settings.json');
  writeFileSync(outPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(`  Claude Code settings written to: ${outPath}`);
  console.log(`  Copy the mcpServers block into ~/.claude/settings.json`);
  console.log('');
}

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  console.log('\nShutting down all gateways...');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
