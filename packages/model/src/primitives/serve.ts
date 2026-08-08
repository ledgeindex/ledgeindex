/**
 * Minimal OpenAI-compatible local HTTP server backed by the mounted node-llama-cpp runtime.
 *
 *   npx tsx src/primitives/serve.ts --model-path "C:\...\model.gguf"
 *
 * Supports:
 *   POST /v1/chat/completions  (stream true/false)
 *   tools / tool_calls (OpenAI function-calling round-trip for Mastra agents)
 *   response_format.type = json_schema | json_object  (via LlamaJsonSchemaGrammar)
 *
 * AI SDK:
 *   createOpenAI({ baseURL: "http://127.0.0.1:8787/v1", apiKey: "local" })
 *   streamText / generateText / generateObject
 */
import http from "node:http";
import {
  Gemma4ChatWrapper,
  LlamaChat,
  LlamaChatSession,
  type LlamaChatResponseChunk,
  type LlamaGrammar,
  type LlamaJsonSchemaGrammar,
  type Token,
} from "node-llama-cpp";
import { flagNumber, flagString, parseArgs } from "../cli-args.js";
import { GEMMA4_E2B_DEFAULT_PROMPT, GEMMA4_E2B_MODEL_ID } from "../presets/gemma4-e2b.js";
import type { LocalMountableChatFamily } from "../presets/local-mountables.js";
import { thoughtTokensFromRequest } from "../reasoning.js";
import {
  DEFAULT_CONTEXT_SIZE,
  DEFAULT_FLASH_ATTENTION,
  DEFAULT_GPU_LAYERS,
  DEFAULT_SEQUENCES,
  DEFAULT_SERVE_HOST,
  DEFAULT_SERVE_PORT,
  MAX_SEQUENCES,
  type MountedRuntime,
  type MountSettings,
} from "../types.js";
import { isMainModule } from "../utils.js";
import { computeMetrics, printMetrics } from "./chat.js";
import { mount, unmount } from "./mount.js";
import {
  messagesNeedToolAwareChat,
  openAiMessagesToChatSessionInput,
  openAiMessagesToLlamaChatHistory,
  type ChatMessage,
} from "./openai-chat-history.js";
import {
  llamaFunctionCallsToOpenAiToolCalls,
  openAiToolsToChatModelFunctions,
  type OpenAiTool,
} from "./openai-tools.js";

type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name?: string;
        description?: string;
        schema?: Record<string, unknown>;
        strict?: boolean | null;
      };
    };

type ChatBody = {
  model?: string;
  stream?: boolean;
  messages?: ChatMessage[];
  tools?: OpenAiTool[];
  tool_choice?: unknown;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: "off" | "low" | "medium" | "high";
  thought_tokens?: number;
  response_format?: ResponseFormat;
};

const LOOSE_JSON_OBJECT_SCHEMA = { type: "object", additionalProperties: true } as const;

/** Limits in-flight chat completions to the mounted context's sequence count. */
class SequenceGate {
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  get capacity(): number {
    return this.max;
  }

  get active(): number {
    return this.inFlight;
  }

  async acquire(): Promise<void> {
    if (this.inFlight < this.max) {
      this.inFlight += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.inFlight = Math.max(0, this.inFlight - 1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * node-llama-cpp reclaims disposed sequence ids asynchronously (withLock).
 * Wait until a free slot is actually available before getSequence().
 */
async function takeContextSequence(
  context: MountedRuntime["context"],
): Promise<ReturnType<MountedRuntime["context"]["getSequence"]>> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (context.sequencesLeft > 0) {
      return context.getSequence();
    }
    await sleep(5);
  }
  throw new Error("No sequences left");
}

export {
  openAiMessagesToChatSessionInput,
  openAiMessagesToLlamaChatHistory,
  messageText,
  type ChatMessage,
} from "./openai-chat-history.js";
export {
  openAiToolsToChatModelFunctions,
  llamaFunctionCallsToOpenAiToolCalls,
  type OpenAiTool,
  type OpenAiToolCall,
} from "./openai-tools.js";

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

function sseWrite(res: http.ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export type ServeOptions = MountSettings & {
  port?: number;
  host?: string;
  modelId?: string;
  /** Gemma 4 uses explicit wrapper for reasoning channels; others auto-detect. */
  chatFamily?: LocalMountableChatFamily;
};

export type ServeHandle = {
  baseURL: string;
  port: number;
  host: string;
  sequences: number;
  stop: () => Promise<void>;
};

let currentServer: { server: http.Server; handle: ServeHandle } | undefined;

export function getBaseURL(): string | undefined {
  return currentServer?.handle.baseURL;
}

export async function start(options: ServeOptions = {}): Promise<ServeHandle> {
  if (currentServer) return currentServer.handle;

  const port = options.port ?? DEFAULT_SERVE_PORT;
  const host = options.host ?? DEFAULT_SERVE_HOST;
  const modelId = options.modelId ?? GEMMA4_E2B_MODEL_ID;
  const chatFamily: LocalMountableChatFamily = options.chatFamily ?? "gemma4";
  const sequences =
    typeof options.sequences === "number" && Number.isFinite(options.sequences) && options.sequences >= 1
      ? Math.min(MAX_SEQUENCES, Math.floor(options.sequences))
      : DEFAULT_SEQUENCES;

  const runtime = await mount({
    modelPath: options.modelPath,
    modelUri: options.modelUri,
    modelsDir: options.modelsDir,
    contextSize: options.contextSize ?? DEFAULT_CONTEXT_SIZE,
    gpuLayers: options.gpuLayers ?? DEFAULT_GPU_LAYERS,
    flashAttention: options.flashAttention ?? DEFAULT_FLASH_ATTENTION,
    sequences,
    gpu: options.gpu,
  });

  const sequenceGate = new SequenceGate(runtime.settings.sequences);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        modelPath: runtime.modelPath,
        sequences: sequenceGate.capacity,
        active: sequenceGate.active,
        sequencesLeft: runtime.context.sequencesLeft,
      });
      return;
    }

    if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
      sendJson(res, 200, {
        object: "list",
        data: [{ id: modelId, object: "model", created: Math.floor(Date.now() / 1000), owned_by: "local-node-llama-cpp" }],
      });
      return;
    }

    if (req.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")) {
      let body: ChatBody;
      try {
        body = (await readJson(req)) as ChatBody;
      } catch {
        sendJson(res, 400, { error: { message: "Invalid JSON body" } });
        return;
      }

      const functions = openAiToolsToChatModelFunctions(body.tools);
      const useToolAwareChat =
        Boolean(functions) || messagesNeedToolAwareChat(body.messages);
      const responseMaxTokens = body.max_completion_tokens ?? body.max_tokens ?? 1024;
      const temperature = body.temperature ?? 0.7;
      let thoughtTokens = thoughtTokensFromRequest({
        thoughtTokens: body.thought_tokens,
        reasoningEffort: body.reasoning_effort,
        // Match AG chat UI default (medium) when the client omits effort.
        defaultEffort: "medium",
      });
      // node-llama-cpp maxTokens covers the whole generation (thoughts + answer).
      // Leave headroom for the visible reply after the thought budget.
      let maxTokens =
        thoughtTokens > 0 ? responseMaxTokens + thoughtTokens : responseMaxTokens;
      const reasoningEnabled = thoughtTokens > 0;
      const stream = body.stream === true;
      const id = `chatcmpl_${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      const modelName = body.model ?? modelId;

      /** LM Studio / Mastra OpenAI-compatible: reasoning_content + reasoning. */
      const reasoningDelta = (text: string) => ({
        reasoning: text,
        reasoning_content: text,
      });

      await sequenceGate.acquire();
      let sequence: ReturnType<MountedRuntime["context"]["getSequence"]> | undefined;
      let session: LlamaChatSession | undefined;
      let chat: LlamaChat | undefined;
      let tokenCount = 0;
      let firstTokenMs: number | null = null;
      const startMs = performance.now();

      try {
        sequence = await takeContextSequence(runtime.context);

        let grammar: LlamaGrammar | LlamaJsonSchemaGrammar<never> | undefined;
        const format = body.response_format;
        // Grammar and function-calling are mutually exclusive in node-llama-cpp.
        if (!useToolAwareChat) {
          if (format?.type === "json_object") {
            grammar = await runtime.llama.createGrammarForJsonSchema(LOOSE_JSON_OBJECT_SCHEMA);
          } else if (format?.type === "json_schema") {
            const schema = format.json_schema?.schema;
            if (!schema || typeof schema !== "object") {
              throw new Error("response_format.json_schema.schema is required");
            }
            grammar = await runtime.llama.createGrammarForJsonSchema(schema as never);
          }
          if (grammar) {
            // Grammar + thinking segments fight each other; force direct JSON.
            thoughtTokens = 0;
          }
        }

        const gemmaWrapper =
          chatFamily === "gemma4"
            ? { chatWrapper: new Gemma4ChatWrapper({ reasoning: thoughtTokens > 0 }) }
            : {};

        const onToken = (tokens: Token[]) => {
          if (firstTokenMs == null) firstTokenMs = performance.now();
          tokenCount += tokens.length;
        };

        const writeStreamUsage = (metrics: ReturnType<typeof computeMetrics>) => {
          sseWrite(res, {
            id,
            object: "chat.completion.chunk",
            created,
            model: modelName,
            choices: [],
            usage: {
              prompt_tokens: 0,
              completion_tokens: tokenCount,
              total_tokens: tokenCount,
            },
            stats: {
              tokens_per_second: metrics.tokensPerSec,
              time_to_first_token_seconds: metrics.ttftMs / 1000,
              total_output_tokens: tokenCount,
              generation_time_seconds: metrics.generationDurationSec,
            },
          });
        };

        // --- Tool-aware path: LlamaChat returns functionCalls; Mastra executes tools. ---
        if (useToolAwareChat) {
          const history = openAiMessagesToLlamaChatHistory(body.messages);
          if (history.length === 0) {
            history.push({ type: "user", text: GEMMA4_E2B_DEFAULT_PROMPT });
          }
          console.log(
            `[local-serve] tool-aware chat: tools=${Object.keys(functions ?? {}).length}, history=${history.length}`
          );

          chat = new LlamaChat({
            contextSequence: sequence,
            autoDisposeSequence: false,
            ...gemmaWrapper,
          });

          let content = "";
          let reasoning = "";

          if (stream) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            });
            sseWrite(res, {
              id,
              object: "chat.completion.chunk",
              created,
              model: modelName,
              choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
            });
          }

          const result = await chat.generateResponse(history, {
            maxTokens,
            temperature,
            budgets: { thoughtTokens },
            ...(functions ? { functions } : {}),
            onToken,
            onResponseChunk(chunk: LlamaChatResponseChunk) {
              if (!chunk.text) return;
              if (chunk.type === "segment" && chunk.segmentType === "thought") {
                if (reasoningEnabled) {
                  reasoning += chunk.text;
                  if (stream) {
                    sseWrite(res, {
                      id,
                      object: "chat.completion.chunk",
                      created,
                      model: modelName,
                      choices: [
                        { index: 0, delta: reasoningDelta(chunk.text), finish_reason: null },
                      ],
                    });
                  }
                }
                return;
              }
              if (chunk.type === undefined) {
                content += chunk.text;
                if (stream) {
                  sseWrite(res, {
                    id,
                    object: "chat.completion.chunk",
                    created,
                    model: modelName,
                    choices: [
                      { index: 0, delta: { content: chunk.text }, finish_reason: null },
                    ],
                  });
                }
              }
            },
          });

          const toolCalls = llamaFunctionCallsToOpenAiToolCalls(result.functionCalls);
          const finishReason =
            toolCalls.length > 0 || result.metadata.stopReason === "functionCalls"
              ? "tool_calls"
              : "stop";
          const metrics = computeMetrics({
            startMs,
            firstTokenMs,
            endMs: performance.now(),
            tokenCount,
          });

          if (stream) {
            if (toolCalls.length > 0) {
              sseWrite(res, {
                id,
                object: "chat.completion.chunk",
                created,
                model: modelName,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: toolCalls.map((call, index) => ({
                        index,
                        id: call.id,
                        type: call.type,
                        function: call.function,
                      })),
                    },
                    finish_reason: null,
                  },
                ],
              });
            }
            sseWrite(res, {
              id,
              object: "chat.completion.chunk",
              created,
              model: modelName,
              choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
            });
            writeStreamUsage(metrics);
            res.write("data: [DONE]\n\n");
            res.end();
            printMetrics(metrics);
          } else {
            sendJson(res, 200, {
              id,
              object: "chat.completion",
              created,
              model: modelName,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: content || null,
                    ...(reasoning ? { reasoning, reasoning_content: reasoning } : {}),
                    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
                  },
                  finish_reason: finishReason,
                },
              ],
              usage: {
                prompt_tokens: 0,
                completion_tokens: tokenCount,
                total_tokens: tokenCount,
              },
              stats: {
                tokens_per_second: metrics.tokensPerSec,
                time_to_first_token_seconds: metrics.ttftMs / 1000,
                total_output_tokens: tokenCount,
                generation_time_seconds: metrics.generationDurationSec,
              },
            });
            printMetrics(metrics);
          }
        } else {
          // --- Plain chat path (no tools): LlamaChatSession.prompt ---
          const { system, history, prompt } = openAiMessagesToChatSessionInput(
            body.messages,
            GEMMA4_E2B_DEFAULT_PROMPT
          );

          session = new LlamaChatSession({
            contextSequence: sequence,
            systemPrompt: system,
            autoDisposeSequence: false,
            ...gemmaWrapper,
          });
          if (history.length > 0) {
            session.setChatHistory([...session.getChatHistory(), ...history]);
            console.log(
              `[local-serve] chat history seeded: ${history.length} prior turn(s), prompt=${JSON.stringify(prompt.slice(0, 80))}`
            );
          } else {
            console.log(
              `[local-serve] no prior turns (messages=${body.messages?.length ?? 0}), prompt=${JSON.stringify(prompt.slice(0, 80))}`
            );
          }

          const promptOptions = {
            maxTokens,
            temperature,
            budgets: { thoughtTokens },
            grammar: grammar as LlamaGrammar | undefined,
            onToken,
          };

          if (stream) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            });

            sseWrite(res, {
              id,
              object: "chat.completion.chunk",
              created,
              model: modelName,
              choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
            });

            await session.prompt(prompt, {
              ...promptOptions,
              onResponseChunk(chunk: LlamaChatResponseChunk) {
                if (!chunk.text) return;
                if (chunk.type === "segment" && chunk.segmentType === "thought") {
                  if (!reasoningEnabled) return;
                  sseWrite(res, {
                    id,
                    object: "chat.completion.chunk",
                    created,
                    model: modelName,
                    choices: [
                      { index: 0, delta: reasoningDelta(chunk.text), finish_reason: null },
                    ],
                  });
                  return;
                }
                if (chunk.type === undefined) {
                  sseWrite(res, {
                    id,
                    object: "chat.completion.chunk",
                    created,
                    model: modelName,
                    choices: [
                      { index: 0, delta: { content: chunk.text }, finish_reason: null },
                    ],
                  });
                }
              },
            });

            const streamMetrics = computeMetrics({
              startMs,
              firstTokenMs,
              endMs: performance.now(),
              tokenCount,
            });

            sseWrite(res, {
              id,
              object: "chat.completion.chunk",
              created,
              model: modelName,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            });
            writeStreamUsage(streamMetrics);
            res.write("data: [DONE]\n\n");
            res.end();
            printMetrics(streamMetrics);
          } else {
            let content = "";
            let reasoning = "";
            await session.prompt(prompt, {
              ...promptOptions,
              onResponseChunk(chunk: LlamaChatResponseChunk) {
                if (!chunk.text) return;
                if (chunk.type === "segment" && chunk.segmentType === "thought") {
                  if (reasoningEnabled) reasoning += chunk.text;
                  return;
                }
                if (chunk.type === undefined) content += chunk.text;
              },
            });

            const metrics = computeMetrics({
              startMs,
              firstTokenMs,
              endMs: performance.now(),
              tokenCount,
            });

            sendJson(res, 200, {
              id,
              object: "chat.completion",
              created,
              model: modelName,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content,
                    ...(reasoning ? { reasoning, reasoning_content: reasoning } : {}),
                  },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 0,
                completion_tokens: tokenCount,
                total_tokens: tokenCount,
              },
              stats: {
                tokens_per_second: metrics.tokensPerSec,
                time_to_first_token_seconds: metrics.ttftMs / 1000,
                total_output_tokens: tokenCount,
                generation_time_seconds: metrics.generationDurationSec,
              },
            });
            printMetrics(metrics);
          }
        }
      } catch (error) {
        console.error(error);
        if (!res.headersSent) {
          sendJson(res, 500, {
            error: { message: error instanceof Error ? error.message : String(error) },
          });
        } else if (!res.writableEnded) {
          res.end();
        }
      } finally {
        try {
          session?.dispose({ disposeSequence: false });
        } catch {
          // ignore dispose races
        }
        try {
          chat?.dispose({ disposeSequence: false });
        } catch {
          // ignore dispose races
        }
        try {
          if (sequence && !sequence.disposed) {
            sequence.dispose();
          }
        } catch {
          // ignore dispose races
        }
        sequenceGate.release();
      }
      return;
    }

    sendJson(res, 404, { error: { message: `Not found: ${url.pathname}` } });
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));

  const handle: ServeHandle = {
    baseURL: `http://${host}:${port}/v1`,
    port,
    host,
    sequences: sequenceGate.capacity,
    async stop() {
      await stop();
    },
  };
  currentServer = { server, handle };
  return handle;
}

export async function stop(): Promise<void> {
  const current = currentServer;
  currentServer = undefined;
  if (!current) return;
  await new Promise<void>((resolve, reject) => {
    current.server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const port = flagNumber(args, "port", DEFAULT_SERVE_PORT);
  const contextSize = flagNumber(args, "context", DEFAULT_CONTEXT_SIZE);
  const gpuLayers = flagNumber(args, "gpu-layers", DEFAULT_GPU_LAYERS);
  const sequences = flagNumber(args, "sequences", DEFAULT_SEQUENCES);
  const host = flagString(args, "host", DEFAULT_SERVE_HOST);
  const modelPath = flagString(args, "model-path", "") || undefined;
  const modelUri = flagString(args, "uri", "") || undefined;

  console.log(
    `Loading model for OpenAI-compatible server (gpuLayers=${gpuLayers}, context=${contextSize}, sequences=${sequences})...`,
  );
  const handle = await start({
    modelPath,
    modelUri,
    contextSize,
    gpuLayers,
    sequences,
    flashAttention: true,
    port,
    host,
  });

  console.log(`Listening  : ${handle.baseURL}`);
  console.log(`Health     : http://${handle.host}:${handle.port}/health`);
  console.log(`Sequences  : ${handle.sequences} parallel chat slots`);
  console.log("POST /v1/chat/completions  (stream + tools + response_format json_schema/json_object)");

  const shutdown = async () => {
    console.log("\nShutting down...");
    await stop();
    await unmount();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
