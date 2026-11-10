// The AskUserQuestion dialog in the person's language. Claude Code draws a
// rewrite of the dialog's questions only while the option labels, previews,
// the number of questions and multiSelect stay as asked, and maps the answers
// back to the questions as asked. So the labels stay English and a label's
// translation leads its option's description.
import type { BuiltinToolInputs } from 'claude-code'

export type Questions = BuiltinToolInputs['AskUserQuestion']['questions']

/** The parts of a dialog's answer that the person may have typed rather than picked. */
export type Answers = {
  answers?: Record<string, string>
  response?: string
  annotations?: Record<string, { notes?: string; preview?: string }>
}

/** The prose a dialog draws, labels included; previews are left out (often code). */
export function askTexts(questions: Questions): string[] {
  const texts = new Set<string>()
  for (const q of questions) {
    texts.add(q.question)
    for (const o of q.options) {
      texts.add(o.label)
      if (o.description) texts.add(o.description)
    }
  }
  return [...texts]
}

/** The questions as drawn, given each text's translation (`tr` returns the text when it has none). */
export function translatedQuestions(questions: Questions, tr: (text: string) => string): Questions {
  return questions.map(q => ({
    ...q,
    question: tr(q.question),
    options: q.options.map(o => {
      const label = tr(o.label)
      const parts = [label !== o.label ? label : null, o.description ? tr(o.description) : null].filter(p => p !== null)
      return parts.length > 0 ? { ...o, description: parts.join(' · ') } : o
    }),
  }))
}

/** The answer with each part the person may have typed passed through `f`, which must keep a picked label as it is. */
export async function mapAnswers<T extends Answers>(result: T, f: (text: string) => Promise<string>): Promise<T> {
  const out: T = { ...result }
  if (result.answers) {
    const answers: Record<string, string> = {}
    for (const [question, answer] of Object.entries(result.answers)) answers[question] = await f(answer)
    out.answers = answers
  }
  if (result.response) out.response = await f(result.response)
  if (result.annotations) {
    const annotations: NonNullable<Answers['annotations']> = {}
    for (const [question, a] of Object.entries(result.annotations)) annotations[question] = a.notes ? { ...a, notes: await f(a.notes) } : a
    out.annotations = annotations
  }
  return out
}
