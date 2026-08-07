import type { ClarifyAnswer, ClarifyQuestion } from './schema'

export function formatClarifyAnswersForPrompt(
  questions: ClarifyQuestion[],
  answers: ClarifyAnswer[]
): string {
  if (answers.length === 0) return ''

  const byId = new Map(questions.map((q) => [q.id, q]))
  const lines: string[] = ['User clarification answers (treat as authoritative):']

  for (const answer of answers) {
    const question = byId.get(answer.questionId)
    const label = question?.text ?? answer.questionId
    const optionLabels =
      question?.options
        .filter((opt) => answer.optionIds.includes(opt.id))
        .map((opt) => opt.label) ?? answer.optionIds

    const parts: string[] = []
    if (optionLabels.length > 0) parts.push(optionLabels.join(', '))
    const custom = answer.customText?.trim()
    if (custom) parts.push(custom)

    if (parts.length === 0) continue
    lines.push(`- ${label}: ${parts.join(' — ')}`)
  }

  if (lines.length === 1) return ''
  return lines.join('\n')
}
