import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EmbeddingModel,
  FlagEmbedding,
} from "@mastra/fastembed";
import { embed, embedMany } from "ai";
import { google } from "../llm/model-utils.js";
import { getGoogleGenerativeApiKey, getVectorBackend } from "./config.js";
import { PROD_EMBEDDING_DIMENSION } from "./constants.js";

let localEmbedder: FlagEmbedding | null = null;
let localEmbedderPromise: Promise<FlagEmbedding> | null = null;

const PROD_EMBEDDING_MODEL =
  process.env.LEDGEINDEX_EMBEDDING_MODEL ?? "gemini-embedding-2";

/**
 * Stable cache under ~/.cache/mastra/fastembed-models.
 * Do NOT use FlagEmbedding's default cwd-relative `local_cache` — ag-server's
 * cwd can leave a 0-byte .tar.gz that then fails with TAR_BAD_ARCHIVE.
 */
async function getFastEmbedCacheDir(): Promise<string> {
  const override = process.env.LEDGEINDEX_FASTEMBED_CACHE_DIR?.trim();
  const cachePath =
    override && override.length > 0
      ? override
      : path.join(os.homedir(), ".cache", "mastra", "fastembed-models");
  await mkdir(cachePath, { recursive: true });
  return cachePath;
}

async function getLocalEmbedder(): Promise<FlagEmbedding> {
  if (localEmbedder) return localEmbedder;
  if (!localEmbedderPromise) {
    localEmbedderPromise = (async () => {
      const cacheDir = await getFastEmbedCacheDir();
      const embedder = await FlagEmbedding.init({
        model: EmbeddingModel.BGESmallENV15,
        cacheDir,
        showDownloadProgress: false,
      });
      localEmbedder = embedder;
      return embedder;
    })().catch((error) => {
      localEmbedderPromise = null;
      throw error;
    });
  }
  return localEmbedderPromise;
}

async function collectPassageEmbeddings(texts: string[]): Promise<number[][]> {
  const embedder = await getLocalEmbedder();
  const vectors: number[][] = [];

  for await (const batch of embedder.passageEmbed(texts, 32)) {
    vectors.push(...batch.map((vector) => [...vector]));
  }

  return vectors;
}

function getProdEmbeddingModel() {
  if (!getGoogleGenerativeApiKey()) {
    throw new Error(
      "Cloud retrieval needs GOOGLE_GENERATIVE_AI_API_KEY for Gemini query embeds.",
    );
  }
  return google.embedding(PROD_EMBEDDING_MODEL);
}

const googleEmbeddingOptions = {
  outputDimensionality: PROD_EMBEDDING_DIMENSION,
} as const;

/**
 * Local: FlagEmbedding via @mastra/fastembed (384 dims, no API key).
 * Prod: Google gemini-embedding-2 (1536 dims).
 */
export async function embedQuery(text: string): Promise<number[]> {
  if (getVectorBackend() === "pgvector") {
    const { embedding } = await embed({
      model: getProdEmbeddingModel() as unknown as Parameters<typeof embed>[0]["model"],
      value: text,
      maxRetries: 0,
      providerOptions: {
        google: {
          ...googleEmbeddingOptions,
          taskType: "RETRIEVAL_QUERY",
        },
      },
    });
    return embedding;
  }

  const embedder = await getLocalEmbedder();
  const vector = await embedder.queryEmbed(text);
  return [...vector];
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (getVectorBackend() === "pgvector") {
    const { embeddings } = await embedMany({
      model: getProdEmbeddingModel() as unknown as Parameters<
        typeof embedMany
      >[0]["model"],
      values: texts,
      maxRetries: 0,
      providerOptions: {
        google: {
          ...googleEmbeddingOptions,
          taskType: "RETRIEVAL_DOCUMENT",
        },
      },
    });
    return embeddings;
  }

  return collectPassageEmbeddings(texts);
}
