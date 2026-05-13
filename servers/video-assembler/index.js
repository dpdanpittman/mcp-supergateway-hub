#!/usr/bin/env node
// =============================================================================
// MCP Server: Video Assembler
// =============================================================================
// Wraps FFmpeg for video composition tasks:
//   1. video_compose     — Combine audio, background image, music into a video
//   2. video_get_info    — Get duration, format, codec info for a media file
//   3. video_mix_audio   — Mix narration + background music with volume control
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { access } from "fs/promises";

const execFileAsync = promisify(execFile);

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const FFMPEG_TIMEOUT = parseInt(process.env.FFMPEG_TIMEOUT || "600000", 10); // 10 min

// -----------------------------------------------------------------------------
// FFmpeg helpers
// -----------------------------------------------------------------------------

async function runFFmpeg(args) {
  const { stdout, stderr } = await execFileAsync(FFMPEG, args, {
    timeout: FFMPEG_TIMEOUT,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}

async function runFFprobe(args) {
  const { stdout } = await execFileAsync(FFPROBE, args, {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// MCP Server
// -----------------------------------------------------------------------------

const server = new McpServer({
  name: "video-assembler",
  version: "1.0.0",
});

// Tool 1: Compose video from audio + background image + optional music
server.tool(
  "video_compose",
  "Create a video from a background image and audio track. Applies a slow Ken Burns zoom effect on the image. Optionally mixes in background music at a specified volume. Output is MP4 (H.264 + AAC).",
  {
    background_image: z.string().describe("Path to background image (PNG/JPG)"),
    audio: z.string().describe("Path to primary audio track (narration)"),
    output: z.string().describe("Output video file path (.mp4)"),
    music: z
      .string()
      .optional()
      .describe("Path to background music track (optional)"),
    music_volume: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Background music volume (0-1). Default: 0.15"),
    width: z.number().optional().describe("Output width. Default: 1920"),
    height: z.number().optional().describe("Output height. Default: 1080"),
    zoom_speed: z
      .number()
      .optional()
      .describe("Ken Burns zoom speed (0.0001-0.001). Default: 0.0003"),
    fade_in: z
      .number()
      .optional()
      .describe("Fade-in duration in seconds. Default: 1"),
    fade_out: z
      .number()
      .optional()
      .describe("Fade-out duration in seconds. Default: 2"),
  },
  async ({
    background_image,
    audio,
    output,
    music,
    music_volume,
    width,
    height,
    zoom_speed,
    fade_in,
    fade_out,
  }) => {
    try {
      // Validate inputs exist
      if (!(await fileExists(background_image)))
        throw new Error(`Background image not found: ${background_image}`);
      if (!(await fileExists(audio)))
        throw new Error(`Audio file not found: ${audio}`);
      if (music && !(await fileExists(music)))
        throw new Error(`Music file not found: ${music}`);

      const w = width || 1920;
      const h = height || 1080;
      const zs = zoom_speed || 0.0003;
      const mv = music_volume ?? 0.15;
      const fi = fade_in ?? 1;
      const fo = fade_out ?? 2;

      // Get audio duration for the video length
      const durationStr = await runFFprobe([
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        audio,
      ]);
      const duration = parseFloat(durationStr.trim());

      // Build FFmpeg command
      const args = ["-y"];

      // Input: loop the image for the duration of the audio
      args.push("-loop", "1", "-i", background_image);
      // Input: narration audio
      args.push("-i", audio);

      if (music) {
        // Input: background music
        args.push("-i", music);
      }

      // Ken Burns zoom effect on the image
      const zoomFilter = `scale=${w * 2}:${h * 2},zoompan=z='min(zoom+${zs},1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(duration * 25)}:s=${w}x${h}:fps=25`;

      // Video fade in/out
      const fadeFilter = `fade=t=in:st=0:d=${fi},fade=t=out:st=${(duration - fo).toFixed(1)}:d=${fo}`;

      if (music) {
        // Mix narration + music, then apply audio fade out
        const audioFilter = `[1:a]volume=1.0[narr];[2:a]volume=${mv},atrim=0:${duration.toFixed(1)}[mus];[narr][mus]amix=inputs=2:duration=first[mixed];[mixed]afade=t=out:st=${(duration - fo).toFixed(1)}:d=${fo}[aout]`;

        args.push(
          "-filter_complex",
          `${zoomFilter},${fadeFilter}[v];${audioFilter}`,
          "-map",
          "[v]",
          "-map",
          "[aout]",
        );
      } else {
        // Just narration with audio fade
        const audioFilter = `[1:a]afade=t=out:st=${(duration - fo).toFixed(1)}:d=${fo}[aout]`;

        args.push(
          "-filter_complex",
          `${zoomFilter},${fadeFilter}[v];${audioFilter}`,
          "-map",
          "[v]",
          "-map",
          "[aout]",
        );
      }

      // Encoding settings
      args.push(
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-t",
        duration.toFixed(1),
        "-pix_fmt",
        "yuv420p",
        "-shortest",
        output,
      );

      const start = Date.now();
      await runFFmpeg(args);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      return {
        content: [
          {
            type: "text",
            text: [
              "Video composed successfully.",
              `Output: ${output}`,
              `Duration: ${duration.toFixed(1)}s`,
              `Resolution: ${w}x${h}`,
              `Music: ${music ? `yes (vol: ${mv})` : "none"}`,
              `Render time: ${elapsed}s`,
            ].join("\n"),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: `Video composition failed: ${err.message}` },
        ],
        isError: true,
      };
    }
  },
);

// Tool 2: Get media file info
server.tool(
  "video_get_info",
  "Get duration, format, codec, and resolution info for any media file (audio or video).",
  {
    file: z.string().describe("Path to the media file"),
  },
  async ({ file }) => {
    try {
      if (!(await fileExists(file))) throw new Error(`File not found: ${file}`);

      const output = await runFFprobe([
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        file,
      ]);

      const info = JSON.parse(output);
      const format = info.format || {};
      const streams = info.streams || [];

      const summary = {
        filename: format.filename,
        duration: parseFloat(format.duration || 0).toFixed(1) + "s",
        size: ((format.size || 0) / 1024 / 1024).toFixed(1) + " MB",
        format: format.format_long_name,
        streams: streams.map((s) => ({
          type: s.codec_type,
          codec: s.codec_name,
          ...(s.width && { resolution: `${s.width}x${s.height}` }),
          ...(s.sample_rate && { sample_rate: s.sample_rate }),
          ...(s.channels && { channels: s.channels }),
        })),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: `Error getting file info: ${err.message}` },
        ],
        isError: true,
      };
    }
  },
);

// Tool 3: Mix audio tracks
server.tool(
  "video_mix_audio",
  "Mix two audio files together (e.g., narration + background music). Control relative volumes. Outputs a single audio file.",
  {
    primary: z.string().describe("Path to primary audio (e.g., narration)"),
    secondary: z
      .string()
      .describe("Path to secondary audio (e.g., background music)"),
    output: z.string().describe("Output audio file path"),
    primary_volume: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .describe("Primary track volume. Default: 1.0"),
    secondary_volume: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .describe("Secondary track volume. Default: 0.15"),
    fade_out: z
      .number()
      .optional()
      .describe("Fade-out duration in seconds at the end. Default: 2"),
  },
  async ({
    primary,
    secondary,
    output,
    primary_volume,
    secondary_volume,
    fade_out,
  }) => {
    try {
      if (!(await fileExists(primary)))
        throw new Error(`Primary audio not found: ${primary}`);
      if (!(await fileExists(secondary)))
        throw new Error(`Secondary audio not found: ${secondary}`);

      const pv = primary_volume ?? 1.0;
      const sv = secondary_volume ?? 0.15;
      const fo = fade_out ?? 2;

      // Get primary duration for trimming secondary and fade
      const durationStr = await runFFprobe([
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        primary,
      ]);
      const duration = parseFloat(durationStr.trim());

      const args = [
        "-y",
        "-i",
        primary,
        "-i",
        secondary,
        "-filter_complex",
        `[0:a]volume=${pv}[a1];[1:a]volume=${sv},atrim=0:${duration.toFixed(1)}[a2];[a1][a2]amix=inputs=2:duration=first,afade=t=out:st=${(duration - fo).toFixed(1)}:d=${fo}[out]`,
        "-map",
        "[out]",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        output,
      ];

      const start = Date.now();
      await runFFmpeg(args);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      return {
        content: [
          {
            type: "text",
            text: [
              "Audio mixed successfully.",
              `Output: ${output}`,
              `Duration: ${duration.toFixed(1)}s`,
              `Primary vol: ${pv}, Secondary vol: ${sv}`,
              `Fade out: ${fo}s`,
              `Time: ${elapsed}s`,
            ].join("\n"),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: `Audio mixing failed: ${err.message}` },
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
