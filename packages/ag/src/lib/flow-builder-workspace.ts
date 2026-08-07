import { Workspace, LocalFilesystem, WORKSPACE_TOOLS } from '@mastra/core/workspace'
import type { RequestContext } from '@mastra/core/request-context'
import { flowPackageDir } from './flow-package-paths'

function packagePathFromContext(requestContext?: RequestContext): string | undefined {
  const direct = requestContext?.get('flowPackagePath')
  if (typeof direct === 'string' && direct.trim()) return direct.trim()

  const flowId = requestContext?.get('flow_id')
  if (typeof flowId === 'string' && flowId.trim()) {
    return flowPackageDir(flowId.trim())
  }
  return undefined
}

function requireFlowPackagePath(requestContext?: RequestContext): string {
  const basePath = packagePathFromContext(requestContext)
  if (!basePath) {
    throw new Error('flowPackagePath or flow_id missing from requestContext')
  }
  return basePath
}

/** Workspace for surgical heal — read + edit only. */
export function createHealWorkspace(): Workspace {
  return new Workspace({
    filesystem: ({ requestContext }) => {
      return new LocalFilesystem({ basePath: requireFlowPackagePath(requestContext) })
    },
    tools: {
      enabled: true,
      [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: { enabled: false },
      [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: { enabled: false },
      [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: { enabled: false },
      [WORKSPACE_TOOLS.FILESYSTEM.MKDIR]: { enabled: false }
    }
  })
}

/**
 * Workspace for Ask AI flow editing — read / edit / write (new node files + flow.json).
 * No delete or shell.
 */
export function createFlowEditorWorkspace(): Workspace {
  return new Workspace({
    filesystem: ({ requestContext }) => {
      return new LocalFilesystem({ basePath: requireFlowPackagePath(requestContext) })
    },
    tools: {
      enabled: true,
      [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: { enabled: false },
      [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: { enabled: false }
    }
  })
}
