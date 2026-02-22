# MCP Supergateway Hub

Run 60+ MCP servers on a single machine, each exposed as a streamable HTTP endpoint via [supergateway](https://github.com/supercorp-ai/supergateway). Connect Claude Code (or any MCP client) to all of them over your network.

## Why?

MCP servers typically run as stdio processes — great for local use, but can't be shared across machines. This hub wraps each server in a supergateway instance that bridges stdio to HTTP, so you can run all your MCP servers on a dedicated box and connect from any dev machine.

Claude Code's **Tool Search** feature means having many servers configured costs almost nothing — it only loads what it needs per query.

## Quick Start

```bash
# Clone and install
git clone https://github.com/dpdanpittman/mcp-supergateway-hub.git
cd mcp-server-stack

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

After launching, the hub generates a `claude-settings.json` file. Copy the `mcpServers` block into your `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "github": { "url": "http://YOUR_SERVER_IP:3170/mcp" },
    "git": { "url": "http://YOUR_SERVER_IP:3171/mcp" },
    "memory": { "url": "http://YOUR_SERVER_IP:3172/mcp" }
  }
}
```

## Run as a Service

```bash
sudo cp mcp-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mcp-gateway
```

## Configuration

Edit `.env` to add API keys for services that need them. Servers without keys will still start but won't authenticate with external APIs.

Edit `gateway/servers.js` to add, remove, or modify servers.

## Requirements

- Node.js 22+
- Python 3.10+ with [uv](https://docs.astral.sh/uv/) (for uvx-based servers)
- Docker (for docker MCP server)

## Included Servers (60)

| Category | Servers |
|----------|---------|
| Core Dev | filesystem, git, github, memory, sequential-thinking, fetch, time, docker |
| Databases | postgres, sqlite, mongodb, redis |
| Cloud | cloudflare, terraform, kubernetes, localstack |
| Browser | playwright, puppeteer, brave-search, pagemap |
| Communication | slack, discord, notion |
| Creative | figma, blender, ableton, reaper, svgmaker, manim, davinci-resolve |
| Smart Home | home-assistant |
| Finance | coingecko, alpaca, crypto-trading, crypto-portfolio, alphavantage, bankless-onchain |
| Monitoring | sentry, axiom |
| Data & APIs | anyquery, pipedream, apify, e2b, mindsdb |
| AI Bridges | ollama, openai, gemini, openai-image, google-imagen |
| Gaming | aseprite |
| DevOps | atlassian, azure-devops, gitlab |
| Misc | youtube-transcript, spotify, open-library, tmdb, personalization |
| Meta | everything, forage |

## License

MIT
