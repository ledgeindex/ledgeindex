import { readFileSync, writeFileSync } from 'fs'
import type { Agent } from '@mastra/core/agent'
import { RequestContext } from '@mastra/core/request-context'
import type { FlowPlan } from './flow-plan'
import type { NodeCodegenTask } from './node-codegen-templates'
import { generateNodeSourceWithAgent } from './node-codegen'
import {
  formatCodegenImplContextForPrompt,
  selectCodegenImplContext
} from './planning-context/codegen-impl-context'
import {
  ensureFlowPackageDirs,
  flowPackageDir,
  nodeSourceFilePath,
  nodeSourceRelativePath
} from './flow-package-paths'
import { validateFlowNodeSource, type ValidationError } from './validate-flow-node'

const MAX_HEAL_ATTEMPTS = 2

export type RecordedToolCall = {
  name: string
  args: Record<string, unknown>
  iteration: number
}

export type NodeEvalProgressEvent =
  | { type: 'node-codegen-start'; nodeId: string; label: string }
  | { type: 'node-codegen-done'; nodeId: string; fromAgent: boolean }
  | { type: 'node-validate-start'; nodeId: string }
  | { type: 'node-validate-fail'; nodeId: string; errors: ValidationError[] }
  | { type: 'node-heal-start'; nodeId: string; attempt: number }
  | { type: 'node-heal-done'; nodeId: string; attempt: number; toolCalls: RecordedToolCall[] }
  | { type: 'node-eval-done'; nodeId: string; fromAgent: boolean }
  | { type: 'node-eval-failed'; nodeId: string; message: string }

export type NodeEvalResult = {
  nodeId: string
  source: string
  fromAgent: boolean
  warning?: string
  healToolCalls: RecordedToolCall[]
  healAttempts: number
}

function formatErrorsForPrompt(errors: ValidationError[]): string {
  return errors
    .map((error) => {
      const pos =
        error.line !== undefined
          ? `${error.file}:${error.line}${error.col !== undefined ? `:${error.col}` : ''}`
          : error.file
      return `- ${pos} — ${error.message}`
    })
    .join('\n')
}

function buildHealPrompt(
  task: NodeCodegenTask,
  plan: FlowPlan,
  relativePath: string,
  errors: ValidationError[],
  attempt: number
): string {
  const implBlock = formatCodegenImplContextForPrompt(selectCodegenImplContext(task.phase, plan))
  return `Fix TypeScript errors in ${relativePath} for automation step "${task.label}".

Flow: ${plan.title}
Step spec: ${task.spec}
Behavior: ${task.phase.plan}
${implBlock}
Validation errors (attempt ${attempt}/${MAX_HEAL_ATTEMPTS}):
${formatErrorsForPrompt(errors)}

Instructions:
- Read the file with mastra_workspace_read_file
- Fix ONLY the reported issues using mastra_workspace_edit_file (old_string → new_string)
- Do NOT rewrite the whole file — surgical edits only
- Keep export default async function main($input, $ctx)
- Honor required packages / outputShape / docs examples above when relevant
- Do not change unrelated code
- After edits, respond briefly that fixes are done`
}

async function healNodeWithAgent(
  agent: Agent,
  task: NodeCodegenTask,
  plan: FlowPlan,
  flowId: string,
  errors: ValidationError[],
  attempt: number
): Promise<{ toolCalls: RecordedToolCall[] }> {
  const flowPackagePath = flowPackageDir(flowId)
  const relativePath = nodeSourceRelativePath(task.nodeId)
  const requestContext = new RequestContext([
    ['flowPackagePath', flowPackagePath],
    ['nodeId', task.nodeId]
  ])

  const toolCalls: RecordedToolCall[] = []

  await agent.generate(buildHealPrompt(task, plan, relativePath, errors, attempt), {
    maxSteps: 10,
    requestContext,
    onIterationComplete: ({ iteration, toolCalls: iterationCalls }) => {
      for (const call of iterationCalls) {
        toolCalls.push({
          name: call.name,
          args: call.args,
          iteration
        })
      }
    }
  })

  return { toolCalls }
}

async function runValidateHealLoop(options: {
  agent: Agent
  task: NodeCodegenTask
  plan: FlowPlan
  flowId: string
  initialSource: string
  fromAgent: boolean
  onProgress?: (event: NodeEvalProgressEvent) => void | Promise<void>
}): Promise<NodeEvalResult> {
  const { agent, task, plan, flowId, fromAgent, onProgress } = options
  const relativePath = nodeSourceRelativePath(task.nodeId)

  ensureFlowPackageDirs(flowId)
  writeFileSync(nodeSourceFilePath(flowId, task.nodeId), options.initialSource, 'utf8')

  let source = options.initialSource
  let healAttempts = 0
  const healToolCalls: RecordedToolCall[] = []

  while (true) {
    await onProgress?.({ type: 'node-validate-start', nodeId: task.nodeId })

    const validation = validateFlowNodeSource(relativePath, source, task)
    if (validation.valid) {
      await onProgress?.({ type: 'node-eval-done', nodeId: task.nodeId, fromAgent })
      return {
        nodeId: task.nodeId,
        source,
        fromAgent,
        healToolCalls,
        healAttempts
      }
    }

    await onProgress?.({
      type: 'node-validate-fail',
      nodeId: task.nodeId,
      errors: validation.errors
    })

    if (healAttempts >= MAX_HEAL_ATTEMPTS) {
      const message = validation.errors.map((e) => e.message).join('; ')
      await onProgress?.({ type: 'node-eval-failed', nodeId: task.nodeId, message })
      throw new Error(
        `Validation failed for ${task.nodeId} after ${MAX_HEAL_ATTEMPTS} heal attempts: ${message}`
      )
    }

    healAttempts += 1
    await onProgress?.({ type: 'node-heal-start', nodeId: task.nodeId, attempt: healAttempts })

    const healResult = await healNodeWithAgent(
      agent,
      task,
      plan,
      flowId,
      validation.errors,
      healAttempts
    )
    healToolCalls.push(...healResult.toolCalls)

    await onProgress?.({
      type: 'node-heal-done',
      nodeId: task.nodeId,
      attempt: healAttempts,
      toolCalls: healResult.toolCalls
    })

    source = readFileSync(nodeSourceFilePath(flowId, task.nodeId), 'utf8')
  }
}

/** Full path: LLM codegen → write disk → validate → heal loop. */
export async function evalNodeCodegen(options: {
  agent: Agent
  /** Defaults to `agent` when omitted (tests). */
  healAgent?: Agent
  task: NodeCodegenTask
  plan: FlowPlan
  flowId: string
  onProgress?: (event: NodeEvalProgressEvent) => void | Promise<void>
}): Promise<NodeEvalResult> {
  const { agent, task, plan, flowId, onProgress } = options
  const healAgent = options.healAgent ?? agent

  await onProgress?.({ type: 'node-codegen-start', nodeId: task.nodeId, label: task.label })

  ensureFlowPackageDirs(flowId)
  const requestContext = new RequestContext([
    ['flowPackagePath', flowPackageDir(flowId)],
    ['nodeId', task.nodeId]
  ])

  const generated = await generateNodeSourceWithAgent(agent, task, plan, requestContext)
  await onProgress?.({ type: 'node-codegen-done', nodeId: task.nodeId, fromAgent: generated.fromAgent })

  return runValidateHealLoop({
    agent: healAgent,
    task,
    plan,
    flowId,
    initialSource: generated.source,
    fromAgent: generated.fromAgent,
    onProgress
  })
}

/** Heal-only path: start from intentionally broken on-disk source (integration tests). */
export async function evalNodeHealFromSource(options: {
  agent: Agent
  task: NodeCodegenTask
  plan: FlowPlan
  flowId: string
  brokenSource: string
  onProgress?: (event: NodeEvalProgressEvent) => void | Promise<void>
}): Promise<NodeEvalResult> {
  return runValidateHealLoop({
    agent: options.agent,
    task: options.task,
    plan: options.plan,
    flowId: options.flowId,
    initialSource: options.brokenSource,
    fromAgent: false,
    onProgress: options.onProgress
  })
}
