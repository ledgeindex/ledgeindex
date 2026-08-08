import { mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export function flowsRootDir(): string {
  return process.env.AUTOMATIONGHOST_FLOWS_ROOT ?? join(tmpdir(), 'automationghost-flows')
}

export function flowPackageDir(flowId: string): string {
  return join(flowsRootDir(), flowId)
}

export function flowNodesDir(flowId: string): string {
  return join(flowPackageDir(flowId), 'nodes')
}

export function nodeSourceRelativePath(nodeId: string): string {
  return `nodes/${nodeId}.ts`
}

export function nodeSourceFilePath(flowId: string, nodeId: string): string {
  return join(flowNodesDir(flowId), `${nodeId}.ts`)
}

export function ensureFlowPackageDirs(flowId: string): void {
  mkdirSync(flowNodesDir(flowId), { recursive: true })
}

export function flowCustomInfoPath(flowId: string): string {
  return join(flowPackageDir(flowId), 'custom-info.json')
}
