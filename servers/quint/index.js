#!/usr/bin/env node
// =============================================================================
// MCP Server: Quint Formal Specification Language
// =============================================================================
// Wraps the Quint CLI to provide formal verification tools via MCP.
// Tools: quint_typecheck, quint_run, quint_test, quint_verify, quint_parse, quint_docs
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "child_process";
import { writeFile, unlink, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUINT_CMD = process.env.QUINT_CMD || "quint";
const QUINT_TIMEOUT = parseInt(process.env.QUINT_TIMEOUT || "120000", 10);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function runQuint(args) {
  return new Promise((resolve) => {
    execFile(
      QUINT_CMD,
      args,
      { timeout: QUINT_TIMEOUT, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // quint exits non-zero on errors/failures — that's expected, not a crash
          resolve({
            ok: false,
            stdout,
            stderr,
            code: err.code,
            exitCode: err.code === "ENOENT" ? -1 : (err.status ?? 1),
          });
        } else {
          resolve({ ok: true, stdout, stderr, exitCode: 0 });
        }
      },
    );
  });
}

async function withTempFile(source, fn) {
  const name = `quint_${randomBytes(8).toString("hex")}.qnt`;
  const path = join(tmpdir(), name);
  await writeFile(path, source, "utf-8");
  try {
    return await fn(path);
  } finally {
    await unlink(path).catch(() => {});
  }
}

async function resolveSource(source, filePath) {
  if (source) {
    return { useTempFile: true, source };
  }
  if (filePath) {
    return { useTempFile: false, filePath };
  }
  throw new Error("Either source or file_path must be provided");
}

async function runWithSource(source, filePath, buildArgs) {
  const resolved = await resolveSource(source, filePath);

  if (resolved.useTempFile) {
    return withTempFile(resolved.source, async (tmpPath) => {
      const args = buildArgs(tmpPath);
      return runQuint(args);
    });
  }

  const args = buildArgs(resolved.filePath);
  return runQuint(args);
}

function formatResult(result) {
  if (result.exitCode === -1) {
    return {
      content: [
        {
          type: "text",
          text: "Error: quint CLI not found. Install it with: npm i -g @informalsystems/quint",
        },
      ],
      isError: true,
    };
  }

  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  return {
    content: [{ type: "text", text: output || "(no output)" }],
    isError: !result.ok,
  };
}

// Source/file_path schema shared by most tools
const sourceSchema = {
  source: z
    .string()
    .optional()
    .describe("Quint specification source code (.qnt content)"),
  file_path: z.string().optional().describe("Path to a .qnt file on disk"),
};

// -----------------------------------------------------------------------------
// Load cheatsheet
// -----------------------------------------------------------------------------

let cheatsheet = {};
try {
  const raw = await readFile(
    join(__dirname, "reference", "cheatsheet.json"),
    "utf-8",
  );
  cheatsheet = JSON.parse(raw);
} catch {
  // cheatsheet will be empty — quint_docs will report it
}

// -----------------------------------------------------------------------------
// MCP Server
// -----------------------------------------------------------------------------

const server = new McpServer({
  name: "quint",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Tool 1: quint_typecheck
// ---------------------------------------------------------------------------

server.tool(
  "quint_typecheck",
  "Type-check a Quint specification. Returns success or type errors with locations. Provide either source code or a file path.",
  sourceSchema,
  async ({ source, file_path }) => {
    try {
      const result = await runWithSource(source, file_path, (f) => [
        "typecheck",
        f,
      ]);
      return formatResult(result);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 2: quint_run
// ---------------------------------------------------------------------------

server.tool(
  "quint_run",
  "Simulate a Quint specification with random execution. Runs the state machine and optionally checks an invariant. Returns pass/fail and a counterexample trace if the invariant is violated.",
  {
    ...sourceSchema,
    init: z.string().optional().describe('Init action name (default: "init")'),
    step: z.string().optional().describe('Step action name (default: "step")'),
    invariant: z
      .string()
      .optional()
      .describe("Invariant to check during simulation"),
    max_samples: z
      .number()
      .optional()
      .describe("Number of simulation runs (default: 10000)"),
    max_steps: z
      .number()
      .optional()
      .describe("Max steps per run (default: 20)"),
    seed: z.number().optional().describe("Random seed for reproducibility"),
  },
  async ({
    source,
    file_path,
    init,
    step,
    invariant,
    max_samples,
    max_steps,
    seed,
  }) => {
    try {
      const result = await runWithSource(source, file_path, (f) => {
        const args = ["run"];
        if (init) args.push(`--init=${init}`);
        if (step) args.push(`--step=${step}`);
        if (invariant) args.push(`--invariant=${invariant}`);
        if (max_samples != null) args.push(`--max-samples=${max_samples}`);
        if (max_steps != null) args.push(`--max-steps=${max_steps}`);
        if (seed != null) args.push(`--seed=${seed}`);
        args.push(f);
        return args;
      });
      return formatResult(result);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 3: quint_test
// ---------------------------------------------------------------------------

server.tool(
  "quint_test",
  "Run named test definitions (run statements) from a Quint spec. Returns pass/fail for each test with failure details.",
  {
    ...sourceSchema,
    match: z
      .string()
      .optional()
      .describe(
        'Regex to filter test names (e.g. "transfer" to run only tests matching "transfer")',
      ),
  },
  async ({ source, file_path, match }) => {
    try {
      const result = await runWithSource(source, file_path, (f) => {
        const args = ["test"];
        if (match) args.push(`--match=${match}`);
        args.push(f);
        return args;
      });
      return formatResult(result);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 4: quint_verify
// ---------------------------------------------------------------------------

server.tool(
  "quint_verify",
  "Exhaustive model checking of a Quint spec via Apalache (requires Java 17+). Slower than simulation but checks ALL reachable states. Returns pass or a counterexample trace. Falls back gracefully if Apalache is not installed.",
  {
    ...sourceSchema,
    init: z.string().optional().describe('Init action name (default: "init")'),
    step: z.string().optional().describe('Step action name (default: "step")'),
    invariant: z.string().describe("Invariant to verify (required)"),
    max_steps: z
      .number()
      .optional()
      .describe("Max steps for bounded model checking (default: 10)"),
  },
  async ({ source, file_path, init, step, invariant, max_steps }) => {
    try {
      const result = await runWithSource(source, file_path, (f) => {
        const args = ["verify"];
        if (init) args.push(`--init=${init}`);
        if (step) args.push(`--step=${step}`);
        args.push(`--invariant=${invariant}`);
        if (max_steps != null) args.push(`--max-steps=${max_steps}`);
        args.push(f);
        return args;
      });

      // Add hint if Apalache is missing
      const output = [result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n")
        .trim();
      if (
        result.exitCode !== 0 &&
        (output.includes("Apalache") ||
          output.includes("java") ||
          output.includes("JAVA_HOME"))
      ) {
        return {
          content: [
            {
              type: "text",
              text:
                output +
                "\n\nHint: quint verify requires Apalache (Java 17+). Install Java and Apalache, or use quint_run for simulation-based checking.",
            },
          ],
          isError: true,
        };
      }

      return formatResult(result);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 5: quint_parse
// ---------------------------------------------------------------------------

server.tool(
  "quint_parse",
  "Parse a Quint spec and return the intermediate representation (IR) as JSON. Useful for inspecting the AST or checking for parse errors.",
  sourceSchema,
  async ({ source, file_path }) => {
    try {
      const outFile = join(
        tmpdir(),
        `quint_ir_${randomBytes(8).toString("hex")}.json`,
      );
      const result = await runWithSource(source, file_path, (f) => [
        "parse",
        `--out=${outFile}`,
        f,
      ]);

      if (result.ok) {
        try {
          const ir = await readFile(outFile, "utf-8");
          await unlink(outFile).catch(() => {});
          return { content: [{ type: "text", text: ir }] };
        } catch {
          return formatResult(result);
        }
      }

      await unlink(outFile).catch(() => {});
      return formatResult(result);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 6: quint_docs
// ---------------------------------------------------------------------------

server.tool(
  "quint_docs",
  "Quick reference for Quint syntax and built-in operators. Returns a curated cheat sheet for the requested topic. No CLI call needed.",
  {
    topic: z
      .string()
      .describe(
        'Topic: "sets", "maps", "lists", "actions", "temporal", "types", "modules", "testing", or "all" for the full reference',
      ),
  },
  async ({ topic }) => {
    const topics = Object.keys(cheatsheet);

    if (topics.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Error: cheatsheet reference data not found. Reinstall the server.",
          },
        ],
        isError: true,
      };
    }

    const key = topic.toLowerCase().trim();

    if (key === "all") {
      const sections = topics.map((t) => formatTopic(cheatsheet[t]));
      return { content: [{ type: "text", text: sections.join("\n\n") }] };
    }

    if (cheatsheet[key]) {
      return {
        content: [{ type: "text", text: formatTopic(cheatsheet[key]) }],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Unknown topic "${topic}". Available topics: ${topics.join(", ")}, all`,
        },
      ],
      isError: true,
    };
  },
);

function formatTopic(section) {
  const lines = [`## ${section.title}`, section.description, ""];
  for (const entry of section.entries) {
    lines.push(`  ${entry.syntax}`);
    lines.push(`    → ${entry.description}`);
  }
  return lines.join("\n");
}

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
