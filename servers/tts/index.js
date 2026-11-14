#!/usr/bin/env node
// =============================================================================
// MCP Server: Text-to-Speech
// =============================================================================
// Generates speech audio from text. Supports multiple backends:
//   - coqui: Local Coqui XTTS v2 server (default)
//   - elevenlabs: ElevenLabs API (requires API key)
//
// Tools:
//   1. tts_generate    — Convert text to speech audio file
//   2. tts_list_voices — List available voices for the active backend
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

// Configuration
const TTS_BACKEND = process.env.TTS_BACKEND || "coqui";
const COQUI_URL = process.env.COQUI_URL || "http://localhost:3240";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_URL = "https://api.elevenlabs.io/v1";
const TTS_TIMEOUT = parseInt(process.env.TTS_TIMEOUT || "300000", 10); // 5 min

// -----------------------------------------------------------------------------
// Backend: Coqui XTTS v2
// -----------------------------------------------------------------------------

async function coquiGenerate(text, voice, outputPath) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT);

  try {
    const body = {
      text,
      language: "en",
    };

    // If voice is a path to a reference audio file, use voice cloning
    if (voice && voice.endsWith(".wav")) {
      body.speaker_wav = voice;
    } else if (voice) {
      body.speaker = voice;
    }

    const res = await fetch(`${COQUI_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown error");
      throw new Error(`Coqui TTS error ${res.status}: ${errText}`);
    }

    const audioBuffer = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, audioBuffer);

    return {
      backend: "coqui",
      outputPath,
      sizeBytes: audioBuffer.length,
      format: "wav",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function coquiListVoices() {
  try {
    const res = await fetch(`${COQUI_URL}/speakers`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return ["default"];
    }

    const data = await res.json();
    return Array.isArray(data) ? data : ["default"];
  } catch {
    return ["default"];
  }
}

// -----------------------------------------------------------------------------
// Backend: ElevenLabs
// -----------------------------------------------------------------------------

async function elevenlabsGenerate(text, voiceId, outputPath) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY not set");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT);

  try {
    const vid = voiceId || "Rachel"; // Default ElevenLabs voice
    const res = await fetch(`${ELEVENLABS_URL}/text-to-speech/${vid}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown error");
      throw new Error(`ElevenLabs error ${res.status}: ${errText}`);
    }

    const audioBuffer = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, audioBuffer);

    return {
      backend: "elevenlabs",
      outputPath,
      sizeBytes: audioBuffer.length,
      format: "mp3",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function elevenlabsListVoices() {
  if (!ELEVENLABS_API_KEY) {
    return [
      "Rachel",
      "Domi",
      "Bella",
      "Antoni",
      "Elli",
      "Josh",
      "Arnold",
      "Adam",
      "Sam",
    ];
  }

  try {
    const res = await fetch(`${ELEVENLABS_URL}/voices`, {
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return ["Rachel"];

    const data = await res.json();
    return (
      data.voices?.map((v) => ({ id: v.voice_id, name: v.name })) || ["Rachel"]
    );
  } catch {
    return ["Rachel"];
  }
}

// -----------------------------------------------------------------------------
// Backend dispatcher
// -----------------------------------------------------------------------------

const backends = {
  coqui: { generate: coquiGenerate, listVoices: coquiListVoices },
  elevenlabs: {
    generate: elevenlabsGenerate,
    listVoices: elevenlabsListVoices,
  },
};

function getBackend(name) {
  const backend = backends[name || TTS_BACKEND];
  if (!backend)
    throw new Error(
      `Unknown TTS backend: ${name}. Available: ${Object.keys(backends).join(", ")}`,
    );
  return backend;
}

// -----------------------------------------------------------------------------
// MCP Server
// -----------------------------------------------------------------------------

const server = new McpServer({
  name: "tts",
  version: "1.0.0",
});

server.tool(
  "tts_generate",
  "Generate speech audio from text. Saves a WAV or MP3 file to the specified output path. Use for narration, voiceover, or any text-to-speech task.",
  {
    text: z.string().describe("The text to convert to speech"),
    output_path: z
      .string()
      .describe(
        "Absolute path where the audio file will be saved (e.g. /path/to/narration.wav)",
      ),
    voice: z
      .string()
      .optional()
      .describe(
        "Voice name/ID, or path to a .wav reference file for voice cloning (Coqui only)",
      ),
    backend: z
      .enum(["coqui", "elevenlabs"])
      .optional()
      .describe(`TTS backend to use. Default: ${TTS_BACKEND}`),
  },
  async ({ text, output_path, voice, backend: backendName }) => {
    try {
      const backend = getBackend(backendName);
      const start = Date.now();
      const result = await backend.generate(text, voice, output_path);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      return {
        content: [
          {
            type: "text",
            text: [
              `Audio generated successfully.`,
              `Backend: ${result.backend}`,
              `Output: ${result.outputPath}`,
              `Format: ${result.format}`,
              `Size: ${(result.sizeBytes / 1024).toFixed(1)} KB`,
              `Time: ${elapsed}s`,
            ].join("\n"),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: `TTS generation failed: ${err.message}` },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "tts_list_voices",
  "List available voices for the specified TTS backend.",
  {
    backend: z
      .enum(["coqui", "elevenlabs"])
      .optional()
      .describe(`TTS backend to query. Default: ${TTS_BACKEND}`),
  },
  async ({ backend: backendName }) => {
    try {
      const backend = getBackend(backendName);
      const voices = await backend.listVoices();

      return {
        content: [
          {
            type: "text",
            text: `Available voices (${backendName || TTS_BACKEND}):\n${JSON.stringify(voices, null, 2)}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: `Error listing voices: ${err.message}` },
        ],
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
  console.error("Fatal:", err);
  process.exit(1);
});
