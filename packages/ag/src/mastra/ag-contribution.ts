import { registerApiRoute } from "@mastra/core/server";
import { chatRoute } from "@mastra/ai-sdk";
import type { MastraContribution } from "@ledgeindex/core";
import { weatherWorkflow } from "./workflows/weather-workflow.js";
import { flowBuildWorkflow } from "./workflows/flow-build-workflow/workflow.js";
import { flowVerifyRepairWorkflow } from "./workflows/flow-verify-repair-workflow/workflow.js";
import { weatherAgent } from "./agents/weather-agent.js";
import { planArchitectAgent } from "./agents/plan-architect.js";
import { planRevisionAgent } from "./agents/plan-revision-agent.js";
import { controlIfBuilderAgent } from "./agents/control-if-builder.js";
import { flowArchitectAgent } from "./agents/flow-architect.js";
import { nodeBuilderAgent, nodeCodegenAgent } from "./agents/node-builder.js";
import { pinShaperAgent } from "./agents/pin-shaper-agent.js";
import { agentAssemblerAgent } from "./agents/agent-assembler.js";
import { desktopChatAgent } from "./agents/desktop-chat-agent.js";
import { brainWorkspaceAgent } from "./agents/brain-workspace-agent.js";
import { docsResearchAgent } from "./agents/docs-research-agent.js";
import { planningGateAgent } from "./agents/planning-gate-agent.js";
import { clarifyInquiryAgent } from "./agents/clarify-inquiry-agent.js";
import { flowEditorAgent } from "./agents/flow-editor-agent.js";
import { flowRepairAgent } from "./agents/flow-repair-agent.js";
import { flowAgentContractRepairAgent } from "./agents/flow-agent-contract-repair-agent.js";
import { flowVerifyAnalyzeAgent } from "./agents/flow-verify-analyze-agent.js";
import { flowPackageHealAgent } from "./agents/flow-package-heal-agent.js";
import { flowStructuredAgent } from "./agents/flow-structured-agent.js";
import { flowTextAgent } from "./agents/flow-text-agent.js";
import { shapePinsWithAgent } from "../lib/pin-shape.js";
import { registerFlowVerifyRoutes } from "../runtime/flow-verify-routes.js";
import { registerFlowAgentRoutes } from "../runtime/flow-agent-routes.js";
import { registerFlowPlanRoutes } from "../runtime/flow-plan-routes.js";

/**
 * AutomationGhost agents/workflows/routes for merged LedgeIndex ag-server Mastra.
 */
export function createAgMastraContribution(): MastraContribution {
  return {
    id: "ag",
    workflows: { weatherWorkflow, flowBuildWorkflow, flowVerifyRepairWorkflow },
    agents: {
      weatherAgent,
      desktopChatAgent,
      brainWorkspaceAgent,
      planArchitectAgent,
      planRevisionAgent,
      flowArchitectAgent,
      nodeCodegenAgent,
      nodeBuilderAgent,
      pinShaperAgent,
      agentAssemblerAgent,
      docsResearchAgent,
      planningGateAgent,
      clarifyInquiryAgent,
      controlIfBuilderAgent,
      flowEditorAgent,
      flowRepairAgent,
      flowAgentContractRepairAgent,
      flowVerifyAnalyzeAgent,
      flowPackageHealAgent,
      flowStructuredAgent,
      flowTextAgent,
    },
    server: {
      apiRoutes: [
        chatRoute({
          path: "/chat/weatherAgent",
          agent: "weatherAgent",
          sendReasoning: true,
        }),
        chatRoute({
          path: "/chat/agentAssembler",
          agent: "agentAssemblerAgent",
          sendReasoning: true,
        }),
        chatRoute({
          path: "/chat/desktop-chat-agent",
          agent: "desktop-chat-agent",
          sendReasoning: true,
        }),
        chatRoute({
          path: "/chat/brain-workspace-agent",
          agent: "brain-workspace-agent",
          sendReasoning: true,
        }),
        chatRoute({
          path: "/chat/flow-editor-agent",
          agent: "flow-editor-agent",
          sendReasoning: true,
        }),
        chatRoute({
          path: "/chat/:agentId",
          sendReasoning: true,
        }),
        registerApiRoute("/pins/shape", {
          method: "POST",
          requiresAuth: false,
          handler: async (c) => {
            const body = await c.req.json();
            const result = await shapePinsWithAgent(body);
            return c.json(result, result.ok ? 200 : 422);
          },
        }),
        ...registerFlowVerifyRoutes(),
        ...registerFlowAgentRoutes(),
        ...registerFlowPlanRoutes(),
      ],
    },
  };
}
