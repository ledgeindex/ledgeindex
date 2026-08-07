import { Workspace, LocalFilesystem, WORKSPACE_TOOLS } from '@mastra/core/workspace'
import type { RequestContext } from '@mastra/core/request-context'
import { resolveWorkspaceRoot } from './workspace/io'

function workspaceRootFromContext(requestContext?: RequestContext): string {
  const fromCtx = requestContext?.get('brain_workspace_root')
  if (typeof fromCtx === 'string' && fromCtx.trim()) {
    return fromCtx.trim()
  }
  return resolveWorkspaceRoot()
}

/** Mastra workspace for note markdown files under the brain workspace root. */
export function createBrainWorkspace(): Workspace {
  return new Workspace({
    filesystem: ({ requestContext }) => {
      const basePath = workspaceRootFromContext(requestContext)
      return new LocalFilesystem({ basePath })
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
