#!/usr/bin/env node
// =============================================================================
// MCP Server: Ollama Assistant
// =============================================================================
// A "junior developer" LLM assistant powered by a local Ollama instance.
// Provides three tools:
//   1. ask_local_llm     — General-purpose prompt (summarize, explain, brainstorm)
//   2. generate_code     — Draft code in any language from a description
//   3. analyze_text      — Process large text blobs and return concise analysis
// =============================================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwq:32b';
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || '300000', 10); // 5 min default

// -----------------------------------------------------------------------------
// Ollama API helper
// -----------------------------------------------------------------------------

async function ollamaChat(messages, options = {}) {
  const body = {
    model: options.model || OLLAMA_MODEL,
    messages,
    stream: false,
    options: {
      temperature: options.temperature ?? 0.7,
      num_predict: options.maxTokens ?? 4096,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown error');
      throw new Error(`Ollama API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    return {
      content: data.message?.content || '',
      model: data.model,
      totalDuration: data.total_duration,
      evalCount: data.eval_count,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// -----------------------------------------------------------------------------
// MCP Server setup
// -----------------------------------------------------------------------------

const server = new McpServer({
  name: 'ollama-assistant',
  version: '1.0.0',
});

// ---------------------------------------------------------------------------
// Tool 1: ask_local_llm
// ---------------------------------------------------------------------------

server.tool(
  'ask_local_llm',
  'Send a prompt to the local Ollama LLM. Use for summarization, explanation, brainstorming, or any general-purpose text task. The local model acts as a fast junior assistant — good for first drafts and legwork, but output should be reviewed.',
  {
    prompt: z.string().describe('The prompt or question to send to the local LLM'),
    context: z.string().optional().describe('Additional context (file contents, docs, etc.) to include'),
    system: z.string().optional().describe('Optional system prompt to set the LLM behavior'),
    temperature: z.number().min(0).max(2).optional().describe('Temperature (0=deterministic, 1=creative). Default 0.7'),
    max_tokens: z.number().optional().describe('Max tokens to generate. Default 4096'),
  },
  async ({ prompt, context, system, temperature, max_tokens }) => {
    const messages = [];

    if (system) {
      messages.push({ role: 'system', content: system });
    }

    let userContent = prompt;
    if (context) {
      userContent = `Context:\n${context}\n\n---\n\n${prompt}`;
    }
    messages.push({ role: 'user', content: userContent });

    try {
      const result = await ollamaChat(messages, { temperature, maxTokens: max_tokens });
      const meta = result.evalCount
        ? `\n\n---\n_Model: ${result.model} | Tokens: ${result.evalCount} | Time: ${(result.totalDuration / 1e9).toFixed(1)}s_`
        : '';

      return {
        content: [{ type: 'text', text: result.content + meta }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 2: generate_code
// ---------------------------------------------------------------------------

server.tool(
  'generate_code',
  'Ask the local LLM to draft code. Returns a rough first draft — useful for boilerplate, repetitive patterns, new file scaffolding. The output should be reviewed and refined by the senior (Claude) before use.',
  {
    language: z.string().describe('Programming language (e.g. kotlin, typescript, python)'),
    description: z.string().describe('What the code should do'),
    context: z.string().optional().describe('Existing code, patterns, or file contents to match style against'),
    filename: z.string().optional().describe('Target filename for context (e.g. "UserRepository.kt")'),
  },
  async ({ language, description, context, filename }) => {
    const systemPrompt = [
      `You are a code generator. Write clean, production-ready ${language} code.`,
      'Output ONLY the code — no explanations, no markdown fences, no preamble.',
      'Follow the conventions and patterns shown in the context if provided.',
      filename ? `The target file is: ${filename}` : '',
    ].filter(Boolean).join('\n');

    const userContent = context
      ? `Here is existing code for reference:\n\n${context}\n\n---\n\nGenerate: ${description}`
      : description;

    try {
      const result = await ollamaChat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        { temperature: 0.4, maxTokens: 8192 },
      );

      // Strip markdown code fences if the model added them anyway
      let code = result.content;
      const fenceMatch = code.match(/^```[\w]*\n([\s\S]*?)```$/);
      if (fenceMatch) {
        code = fenceMatch[1];
      }

      const meta = `\n\n---\n_Draft by ${result.model} | ${result.evalCount || '?'} tokens | ${(result.totalDuration / 1e9).toFixed(1)}s — review before use_`;

      return {
        content: [{ type: 'text', text: code + meta }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 3: analyze_text
// ---------------------------------------------------------------------------

server.tool(
  'analyze_text',
  'Send a large text blob to the local LLM for analysis. Use to summarize files, extract key info from logs/docs/API responses, or answer questions about text content. Returns a concise result to save context tokens.',
  {
    text: z.string().describe('The text to analyze (file contents, logs, docs, API response, etc.)'),
    task: z.string().describe('What to do with the text (e.g. "summarize", "find error causes", "list all API endpoints", "extract config values")'),
    format: z.enum(['concise', 'detailed', 'bullets', 'json']).optional()
      .describe('Output format preference. Default: concise'),
  },
  async ({ text, task, format }) => {
    const formatInstructions = {
      concise: 'Be concise — aim for 3-5 sentences max.',
      detailed: 'Be thorough but organized. Use sections if needed.',
      bullets: 'Return a bulleted list. One key point per bullet.',
      json: 'Return valid JSON with relevant structured data.',
    };

    const systemPrompt = [
      'You are a text analysis assistant. Analyze the provided text and complete the requested task.',
      formatInstructions[format || 'concise'],
      'Focus on the most important and actionable information.',
    ].join('\n');

    try {
      const result = await ollamaChat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Task: ${task}\n\nText to analyze:\n${text}` },
        ],
        { temperature: 0.3, maxTokens: 4096 },
      );

      const meta = `\n\n---\n_Analyzed by ${result.model} | ${result.evalCount || '?'} tokens | ${(result.totalDuration / 1e9).toFixed(1)}s_`;

      return {
        content: [{ type: 'text', text: result.content + meta }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// -----------------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
