import type { Processor, ProcessOutputStreamArgs } from "@mastra/core/processors";
import type { ChunkType } from "@mastra/core/stream";
import {
  LEDGEINDEX_RETRIEVAL_META_KEY,
  type RetrievalMeta,
} from "../../retrieval/retrieval-meta.js";

/** Emits retrieval metadata to the client once, before the answer streams. */
export class RetrievalMetaEmitter implements Processor {
  readonly id = "retrieval-meta-emitter";
  readonly name = "Retrieval Meta Emitter";

  async processOutputStream({
    part,
    state,
    requestContext,
    writer,
  }: ProcessOutputStreamArgs) {
    if (state.emitted) return part;

    const meta = requestContext?.get?.(LEDGEINDEX_RETRIEVAL_META_KEY) as
      | RetrievalMeta
      | undefined;

    if (meta && writer) {
      await writer.custom({
        type: "data-retrieval",
        data: meta,
      });
    }

    state.emitted = true;
    return part as ChunkType;
  }
}
