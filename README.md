# MCP Supergateway Hub

Run 61 MCP servers on a single machine, each exposed as a streamable HTTP endpoint via [supergateway](https://github.com/supercorp-ai/supergateway). Connect Claude Code (or any MCP client) to all of them over your network.

## Why?

MCP servers typically run as stdio processes — great for local use, but can't be shared across machines. This hub wraps each server in a supergateway instance that bridges stdio to HTTP, so you can run all your MCP servers on a dedicated box and connect from any dev machine.

Claude Code's **Tool Search** feature means having many servers configured costs almost nothing — it only loads what it needs per query.

## Quick Start

```bash
# Clone and install
git clone https://github.com/dpdanpittman/mcp-supergateway-hub.git
cd mcp-supergateway-hub

# Configure
cp .env.template .env
nano .env  # Add your API keys

# Install gateway dependencies
cd gateway
npm install

# Launch all servers
node index.js
```

## Usage

```bash
# Start all servers
node index.js

# Start only specific servers
node index.js --only github,git,memory,fetch

# Start all except certain servers
node index.js --exclude blender,ableton,reaper

# List all available servers
node index.js --list

# Generate Claude Code settings
node index.js --generate
```

## Connect Claude Code

After launching, the hub generates a `gateway/claude-settings.json` file with all server URLs.

**Important:** Claude Code requires `"type": "http"` in the MCP config. Bare `"url"` entries in settings.json won't work. Add servers with:

```bash
claude mcp add --transport http <name> http://YOUR_SERVER_IP:<port>/mcp
```

Or manually add to your project's `.claude.json`:

```json
{
  "mcpServers": {
    "github": { "type": "http", "url": "http://YOUR_SERVER_IP:3170/mcp" },
    "memory": { "type": "http", "url": "http://YOUR_SERVER_IP:3173/mcp" }
  }
}
```

## Run as a Service (systemd)

```bash
# Edit mcp-gateway.service to match your install path and user
sudo cp mcp-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mcp-gateway
```

The service restarts automatically on failure with a 10-second delay.

## Architecture

```
systemd (mcp-gateway.service)
  └─ node gateway/index.js
       ├─ Reads .env for API keys
       ├─ Spawns one supergateway per server
       │    └─ Bridges stdio ↔ streamable HTTP
       └─ Sequential ports starting at 3170
            ├─ :3170/mcp  filesystem
            ├─ :3171/mcp  git
            ├─ :3172/mcp  github
            └─ ...etc
```

Each server runs as a child process wrapped by supergateway. Servers are launched in batches of 10 to avoid overwhelming the system. If a server hasn't crashed within 5 seconds of launch, it's considered started.

Supergateway is pinned as a local dependency (not via npx) to avoid stale cache issues.

## Configuration

- **`.env`** — API keys and connection strings. Servers without keys will still start but won't authenticate with external APIs.
- **`gateway/servers.js`** — Add, remove, or modify servers. Each entry defines `name`, `command`, `args`, and optional `env` mappings.
- **`servers/`** — Custom server implementations (e.g., `ollama-assistant`).

## Troubleshooting

**Server shows `[OK]` but dies later:**
Supergateway marks a server as OK after 5 seconds. If the underlying service needs authentication (Discord, Slack, etc.), it may crash later when the connection is rejected. Check logs:

```bash
journalctl -u mcp-gateway.service -f | grep DIED
```

**Discord bot crashes with "disallowed intents":**
Enable all three Privileged Gateway Intents in the [Discord Developer Portal](https://discord.com/developers/applications) → Bot → Privileged Gateway Intents (Presence, Server Members, Message Content).

**Empty stderr on crash:**
Some servers write errors to stdout instead of stderr. Test the server directly to see the real error:

```bash
DISCORD_TOKEN=your_token npx mcp-discord
```

**Claude Code can't connect:**
Make sure the config uses `"type": "http"` — bare URL entries are silently ignored. Use `claude mcp add --transport http`.

## Requirements

- Node.js 22+
- Python 3.10+ with [uv](https://docs.astral.sh/uv/) (for uvx-based servers)
- Docker (for docker MCP server)

## Included Servers (61)

| Tier | Category | Servers |
|------|----------|---------|
| 1 | Core Dev | filesystem, git, github, memory, sequential-thinking, fetch, time, docker |
| 2 | Databases | postgres, sqlite, mongodb, redis |
| 3 | Cloud & Infra | cloudflare, terraform, kubernetes, localstack |
| 4 | Browser & Web | playwright, puppeteer, brave-search, pagemap |
| 5 | Communication | slack, discord, notion |
| 6 | Creative & Design | figma, blender, ableton, reaper, svgmaker, manim, davinci-resolve |
| 7 | Smart Home | home-assistant |
| 8 | Finance & Crypto | coingecko, alpaca, crypto-trading, crypto-portfolio, alphavantage, bankless-onchain |
| 9 | Monitoring | sentry, axiom |
| 10 | Data & APIs | anyquery, pipedream, apify, e2b, mindsdb |
| 11 | AI Bridges | ollama-assistant, ollama-bridge, openai-bridge, gemini-bridge, openai-image, google-imagen |
| 12 | Gaming | aseprite |
| 13 | DevOps | atlassian, azure-devops, gitlab |
| 14 | Misc | youtube-transcript, spotify, open-library, tmdb, personalization |
| 15 | Meta | everything, forage |

## License

MIT
