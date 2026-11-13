# AGENTS.md

Instructions for AI coding agents working in this repository.

## What this is

MCP Supergateway Hub runs many MCP (Model Context Protocol) servers on one machine. A Node launcher wraps each stdio server in a [supergateway](https://github.com/supercorp-ai/supergateway) process and exposes it as a streamable HTTP endpoint on its own port, starting at 3170. MCP clients such as Claude Code then connect over the network. The repo is public and in active use: it backs a live homelab setup, and recent commits keep adding servers.

## Layout

- `gateway/index.js`: the launcher. Loads `../.env`, spawns one supergateway per server, respawns crashed ones with backoff, and handles `--list`, `--only`, `--exclude` and `--generate`.
- `gateway/servers.js`: the server list (`name`, `command`, `args`, optional `env`). Ports follow list order, so position matters.
- `servers/`: custom or patched servers (`memory-mabus`, `ollama-assistant`, `quint`, `tts`, `video-assembler`). Each has its own `package.json`.
- `servers/session-essence`: a symlink to a sibling project outside this repo. It is not part of this repo's code. Do not edit through it or commit changes to it.
- `servers/slack/`, `servers/tts/k8s/`, `servers/tts/docker/`: servers that run as their own Kubernetes deployments instead of behind the gateway.
- `mcp-gateway.service`: systemd unit for running the gateway as a service.
- `.env.template`: every environment variable the servers read, with placeholder values only.
- `recipes/`: worked examples that use the gateway.
- `gateway/README.md`: an older copy of the root README. The root `README.md` is current.

## Commands

All gateway commands run from `gateway/`. Requires Node.js 22 or newer.

```bash
cd gateway
npm install                      # installs supergateway and dotenv
node index.js --list             # print every server and its command (safe, starts nothing)
node index.js                    # start all servers (opens many ports)
node index.js --only github,git  # start only these
node index.js --exclude blender  # start all except these
node index.js --generate         # write gateway/claude-settings.json (git-ignored)
```

Custom servers: `cd servers/<name> && npm install && npm start`.

There is no test suite, no linter and no type checker in this repo. The checks that exist:

```bash
node --check gateway/index.js gateway/servers.js
node --check servers/<name>/index.js
cd gateway && node index.js --list
```

Trap: `npm run generate-settings` in `gateway/package.json` points to a `generate-settings.js` file that does not exist. Use `node index.js --generate` instead.

## Deployment

The owner runs and deploys this. The repo shows two paths:

- The gateway runs as a systemd service (`mcp-gateway.service`) on a homelab machine, reading `.env` at start.
- A few servers (Slack, Coqui TTS) run as separate Kubernetes deployments in the `mcp` namespace on the homelab cluster, using manifests under `servers/*/k8s/`. Their tokens live in Kubernetes Secrets, not in this repo.

An agent does not deploy, restart the service, or apply manifests. A change to a running system is a reviewed script that the owner runs.

## Rules for agents

- Ask before large changes. Explain the problem and the proposed fix first. Keep diffs small and surgical.
- Never commit secrets: keys, tokens, passwords, connection strings or `.env` files. Secrets live in a password manager and are read at run time. `.env.template` holds placeholders only; keep it that way.
- Never delete this repository or rewrite published history.
- Do not change `mcp-gateway.service`, Kubernetes manifests, Dockerfiles or other infrastructure files unless that is the task.
- Before saying a change is done, run `node --check` on every changed JS file and `node index.js --list` from `gateway/`. Say plainly what you did not run, such as starting the servers.
- Do not start the full gateway to test a change. It opens dozens of ports and may collide with a running instance. Use `--only <name>` with a free `MCP_BASE_PORT` if you must start something.
- Adding or removing a server in `gateway/servers.js` shifts the port of every server after it. Client configs depend on these ports. Add new servers at the end, and say in the commit which ports moved.
- When you add a server that needs a key, add the variable name with a placeholder to `.env.template` and map it in the `env` field of its entry. Never put a real value in either file.
- Keep the server count and tier table in the root `README.md` in step with `gateway/servers.js`.
- `servers/memory-mabus` is a patched fork of the stock memory server. It must keep reading and writing the same JSONL store format.
- Commit messages: short, imperative, and say what changed.

## Must not be committed or made public

This repository is public.

- No `.env` files, tokens, cookies, API keys or Kubernetes Secret contents.
- No new internal IP addresses, hostnames, usernames, SSH targets or paths under a home directory. Some existing files already hard-code private LAN addresses. Do not add more; prefer environment variables with neutral defaults.
- No personal details about the owner.
- Generated files stay out: `gateway/claude-settings.json` and all `node_modules/` are git-ignored.
