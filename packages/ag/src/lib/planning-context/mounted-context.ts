import { z } from 'zod'

export const mountedWorkspaceItemSchema = z.object({
  kind: z.enum(['channel', 'tab', 'note']),
  label: z.string(),
  content: z.string(),
})

export const mountedAttachmentSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  text: z.string(),
})

export const flowBuildMountedContextSchema = z.object({
  workspace: z.array(mountedWorkspaceItemSchema).default([]),
  attachments: z.array(mountedAttachmentSchema).default([]),
})

export type FlowBuildMountedContext = z.infer<typeof flowBuildMountedContextSchema>

export function formatMountedContextForPrompt(context?: FlowBuildMountedContext | null): string {
  if (!context) return ''
  const lines: string[] = []

  if (context.workspace.length > 0) {
    lines.push('Mounted brain workspace context (use when drafting phases):')
    for (const item of context.workspace) {
      lines.push(`\n[${item.kind.toUpperCase()}] ${item.label}`)
      if (item.content.trim()) {
        lines.push(item.content.trim())
      } else {
        lines.push('(empty)')
      }
    }
  }

  if (context.attachments.length > 0) {
    lines.push('\nUploaded reference files:')
    for (const file of context.attachments) {
      lines.push(`\n[FILE] ${file.name} (${file.mimeType || 'unknown'})`)
      if (file.text.trim()) {
        lines.push(file.text.trim())
      }
    }
  }

  return lines.join('\n')
}
