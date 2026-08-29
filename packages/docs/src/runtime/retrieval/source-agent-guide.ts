import {
  formatSourceAgentGuideForAnswer,
  formatSourceAgentGuideForRewrite,
  sourceAgentGuideFromMetadata,
  type SourceAgentGuide,
} from "../schemas/source-agent-guide.js";
import { getStore } from "../db/index.js";

export async function loadSourceAgentGuide(
  sourceId: string,
): Promise<SourceAgentGuide | null> {
  const source = await getStore().getSource(sourceId);
  return sourceAgentGuideFromMetadata(source?.sourceMetadata);
}

export {
  formatSourceAgentGuideForAnswer,
  formatSourceAgentGuideForRewrite,
};
