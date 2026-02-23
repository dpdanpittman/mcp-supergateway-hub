// =============================================================================
// MCP Server Definitions
// =============================================================================
// Each entry: { name, command, args, env }
// env values reference process.env keys from .env
// =============================================================================

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getServers() {
  const e = process.env;

  return [
    // TIER 1: Core Dev Tools
    { name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'] },
    { name: 'git', command: 'npx', args: ['-y', '@modelcontextprotocol/server-git'] },
    { name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: e.GITHUB_TOKEN } },
    { name: 'memory', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
    { name: 'sequential-thinking', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
    { name: 'fetch', command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'] },
    { name: 'time', command: 'npx', args: ['-y', '@modelcontextprotocol/server-time'] },
    { name: 'docker', command: 'npx', args: ['-y', 'mcp-server-docker'] },

    // TIER 2: Databases
    { name: 'postgres', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', e.POSTGRES_CONNECTION_STRING || ''] },
    { name: 'sqlite', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', e.SQLITE_DB_PATH || '/data/sqlite'] },
    { name: 'mongodb', command: 'npx', args: ['-y', 'mcp-mongo-server'], env: { MONGODB_URI: e.MONGODB_CONNECTION_STRING } },
    { name: 'redis', command: 'npx', args: ['-y', '@modelcontextprotocol/server-redis', e.REDIS_URL || 'redis://localhost:6379'] },

    // TIER 3: Cloud & Infrastructure
    { name: 'cloudflare', command: 'npx', args: ['-y', '@cloudflare/mcp-server-cloudflare'], env: { CLOUDFLARE_API_TOKEN: e.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: e.CLOUDFLARE_ACCOUNT_ID } },
    { name: 'terraform', command: 'npx', args: ['-y', '@hashicorp/terraform-mcp-server'], env: { TFC_TOKEN: e.TFC_TOKEN } },
    { name: 'kubernetes', command: 'npx', args: ['-y', 'mcp-server-kubernetes'] },
    { name: 'localstack', command: 'npx', args: ['-y', 'localstack-mcp-server'] },

    // TIER 4: Browser & Web Automation
    { name: 'playwright', command: 'npx', args: ['-y', '@anthropic/mcp-server-playwright'] },
    { name: 'puppeteer', command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] },
    { name: 'brave-search', command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: e.BRAVE_API_KEY } },
    { name: 'pagemap', command: 'npx', args: ['-y', 'pagemap-mcp'] },

    // TIER 5: Communication & Collaboration
    { name: 'slack', command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'], env: { SLACK_BOT_TOKEN: e.SLACK_BOT_TOKEN, SLACK_TEAM_ID: e.SLACK_TEAM_ID } },
    { name: 'discord', command: 'npx', args: ['-y', 'mcp-discord'], env: { DISCORD_TOKEN: e.DISCORD_BOT_TOKEN } },
    { name: 'notion', command: 'npx', args: ['-y', 'notion-mcp-server'], env: { NOTION_API_KEY: e.NOTION_API_KEY } },

    // TIER 6: Creative & Design
    { name: 'figma', command: 'npx', args: ['-y', '@anthropic/figma-mcp-server'], env: { FIGMA_ACCESS_TOKEN: e.FIGMA_ACCESS_TOKEN } },
    { name: 'blender', command: 'uvx', args: ['blender-mcp'] },
    { name: 'ableton', command: 'uvx', args: ['ableton-mcp'] },
    { name: 'reaper', command: 'npx', args: ['-y', 'reaper-mcp'] },
    { name: 'svgmaker', command: 'npx', args: ['-y', 'svgmaker-mcp'] },
    { name: 'manim', command: 'uvx', args: ['manim-mcp-server'] },
    { name: 'davinci-resolve', command: 'npx', args: ['-y', 'davinci-resolve-mcp'] },

    // TIER 7: Smart Home & IoT
    { name: 'home-assistant', command: 'uvx', args: ['ha-mcp'], env: { HASS_URL: e.HASS_URL, HASS_TOKEN: e.HASS_TOKEN } },

    // TIER 8: Finance & Crypto
    { name: 'coingecko', command: 'npx', args: ['-y', 'coingecko-mcp-server'], env: { COINGECKO_API_KEY: e.COINGECKO_API_KEY } },
    { name: 'alpaca', command: 'npx', args: ['-y', '@alpacahq/alpaca-mcp-server'], env: { ALPACA_API_KEY: e.ALPACA_API_KEY, ALPACA_API_SECRET: e.ALPACA_API_SECRET, ALPACA_PAPER: e.ALPACA_PAPER } },
    { name: 'crypto-trading', command: 'npx', args: ['-y', 'crypto-trading-mcp'] },
    { name: 'crypto-portfolio', command: 'uvx', args: ['crypto-portfolio-mcp'] },
    { name: 'alphavantage', command: 'npx', args: ['-y', 'alphavantage-mcp'], env: { ALPHAVANTAGE_API_KEY: e.ALPHAVANTAGE_API_KEY } },
    { name: 'bankless-onchain', command: 'npx', args: ['-y', '@bankless/onchain-mcp'] },

    // TIER 9: Monitoring & Observability
    { name: 'sentry', command: 'npx', args: ['-y', '@sentry/mcp-server'], env: { SENTRY_AUTH_TOKEN: e.SENTRY_AUTH_TOKEN, SENTRY_ORG: e.SENTRY_ORG } },
    { name: 'axiom', command: 'npx', args: ['-y', '@axiom/mcp-server'], env: { AXIOM_API_TOKEN: e.AXIOM_API_TOKEN, AXIOM_ORG_ID: e.AXIOM_ORG_ID } },

    // TIER 10: Data & APIs
    { name: 'anyquery', command: 'npx', args: ['-y', 'anyquery-mcp'] },
    { name: 'pipedream', command: 'npx', args: ['-y', '@pipedream/mcp-server'] },
    { name: 'apify', command: 'npx', args: ['-y', 'apify-mcp-server'], env: { APIFY_API_TOKEN: e.APIFY_API_TOKEN } },
    { name: 'e2b', command: 'npx', args: ['-y', 'e2b-mcp-server'], env: { E2B_API_KEY: e.E2B_API_KEY } },
    { name: 'mindsdb', command: 'uvx', args: ['mindsdb-mcp-server'] },

    // TIER 11: AI Model Bridges
    { name: 'ollama-assistant', command: 'node', args: [resolve(__dirname, '..', 'servers', 'ollama-assistant', 'index.js')], env: { OLLAMA_HOST: e.OLLAMA_HOST, OLLAMA_MODEL: e.OLLAMA_MODEL } },
    { name: 'ollama-bridge', command: 'npx', args: ['-y', 'mcp-server-ollama-bridge'], env: { OLLAMA_HOST: e.OLLAMA_HOST } },
    { name: 'openai-bridge', command: 'npx', args: ['-y', 'mcp-server-openai-bridge'], env: { OPENAI_API_KEY: e.OPENAI_API_KEY } },
    { name: 'gemini-bridge', command: 'npx', args: ['-y', 'mcp-server-gemini-bridge'], env: { GOOGLE_API_KEY: e.GOOGLE_API_KEY } },
    { name: 'openai-image', command: 'npx', args: ['-y', 'openai-gpt-image-mcp'], env: { OPENAI_API_KEY: e.OPENAI_API_KEY } },
    { name: 'google-imagen', command: 'npx', args: ['-y', 'imagen3-mcp'], env: { GOOGLE_API_KEY: e.GOOGLE_API_KEY } },

    // TIER 12: Gaming & Game Dev
    { name: 'aseprite', command: 'npx', args: ['-y', 'aseprite-mcp'] },

    // TIER 13: DevOps & Code Quality
    { name: 'atlassian', command: 'npx', args: ['-y', '@atlassian/mcp-server'], env: { ATLASSIAN_URL: e.ATLASSIAN_URL, ATLASSIAN_EMAIL: e.ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN: e.ATLASSIAN_API_TOKEN } },
    { name: 'azure-devops', command: 'npx', args: ['-y', 'azure-devops-mcp'], env: { AZURE_DEVOPS_ORG: e.AZURE_DEVOPS_ORG, AZURE_DEVOPS_TOKEN: e.AZURE_DEVOPS_TOKEN } },
    { name: 'gitlab', command: 'npx', args: ['-y', '@modelcontextprotocol/server-gitlab'], env: { GITLAB_TOKEN: e.GITLAB_TOKEN, GITLAB_URL: e.GITLAB_URL } },

    // TIER 14: Misc Power Tools
    { name: 'youtube-transcript', command: 'npx', args: ['-y', 'mcp-server-youtube-transcript'] },
    { name: 'spotify', command: 'npx', args: ['-y', 'spotify-mcp'], env: { SPOTIFY_CLIENT_ID: e.SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET: e.SPOTIFY_CLIENT_SECRET } },
    { name: 'open-library', command: 'npx', args: ['-y', 'mcp-open-library'] },
    { name: 'tmdb', command: 'npx', args: ['-y', 'wizzy-mcp-tmdb'], env: { TMDB_API_KEY: e.TMDB_API_KEY } },
    { name: 'personalization', command: 'uvx', args: ['personalization-mcp'] },

    // TIER 15: Meta / Infrastructure
    { name: 'everything', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] },
    { name: 'forage', command: 'npx', args: ['-y', 'forage-mcp'] },
  ];
}
