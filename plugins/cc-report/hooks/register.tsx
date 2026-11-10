import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Report } from '../types'

const PANE = 'report'

const selected = atom({ plugin: 'cc-report', key: 'selected' } as const, null)
const answers = { plugin: 'cc-report', key: 'answer' } as const
const reports = { plugin: 'cc-report', key: 'report' } as const

// Forks this copy of the module started. A report left pending outside it
// lost its fork to a reload and may be asked for again.
const running = new Set<string>()

/** A placed row's id: 1 to 64 of letters, digits, `_` and `-`. */
const rowIdOf = (turnId: string) => `t${turnId.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64)

const LOCALE = /^([a-z]{2,3})(?:[-_][A-Za-z0-9]+)*(?:\.[^@]*)?(?:@.*)?$/

/** An English language name for a code or locale ("ko", "ko_KR.UTF-8"); any other value as given. */
function languageName(value: string): string | undefined {
  const v = value.trim()
  if (!v || v === 'C' || v === 'POSIX') return undefined
  const code = LOCALE.exec(v)?.[1]
  if (!code) return v
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

async function reportLanguage($: EngineInterface, option: string): Promise<string> {
  const fromOption = languageName(option)
  if (fromOption) return fromOption
  const { language } = (await $.settings.read()) as { language?: unknown }
  const fromSetting = typeof language === 'string' ? languageName(language) : undefined
  if (fromSetting) return fromSetting
  const locales = [await $.env.get('LC_ALL'), await $.env.get('LC_MESSAGES'), await $.env.get('LANG')]
  for (const locale of locales) {
    const fromLocale = languageName(locale ?? '')
    if (fromLocale) return fromLocale
  }
  return 'English'
}

function reportPrompt(answer: string, language: string): string {
  return [
    `You have no tools. Answer straight away, without long deliberation.`,
    ``,
    `Audit the assistant's answer quoted at the end for the person, who already has that answer and reads your report beside it. Judge it against this conversation as it stands. If the answer appears earlier in the conversation, judge it against what came before it, and say whether a later turn changed anything.`,
    ``,
    `Rules:`,
    `1. Add no claim, conclusion or recommendation that the answer or this conversation does not support. Keep the answer's own recommendation; if it made none, say so.`,
    `2. Write for a reader who has not seen the tool output or the earlier turns: what happened, why, what it affects, and where things stand.`,
    `3. Give each load-bearing claim one source: a path with line numbers, a command with the output line that shows it, a tool result, or a URL. Quote at most one short line, and only where the claim turns on it. Where this conversation holds no source, say there is none in this session. Never invent a source. Keep what was observed apart from what is inferred.`,
    `4. Keep what was checked, with each check's result, apart from what was not checked.`,
    `5. State each assumption the answer leaves unstated on one line, with what changes if it is wrong.`,
    `6. Explain once each abbreviation or shorthand the answer leaves unexplained. Keep identifiers, paths, commands and technical terms exactly as written.`,
    `7. If the answer asks the person something, restate it as one question that stands on its own: the options, the answer's pick, and its trade-off.`,
    `8. Use short paragraphs and one idea per sentence. Number ordered steps, one per step; group a long list by topic or priority; use headings only when they aid scanning. No filler, no paraphrase or recap of the answer, no closing offer.`,
    ``,
    `Shape, in this order, leaving out any part with nothing to say:`,
    `- Bottom line: one to three sentences that stand alone: the result, the answer, or the decision the person must make.`,
    `- Decision needed: only when the answer asks something (rule 7).`,
    `- Claims and sources: at most 8 load-bearing claims, each followed by its source and marked checked or not checked.`,
    `- Assumptions: at most 5.`,
    `- Terms: only the shorthand the answer did not explain.`,
    `- Not verified: what remains open.`,
    ``,
    `Keep it within about 350 words (about 1,500 characters in Chinese, Japanese or Korean). Go over only to keep a load-bearing source or a real uncertainty.`,
    ``,
    `Write the report in ${language}, in Markdown. Where the person's instructions in this conversation govern language or terminology, follow them; otherwise the rules, shape and length here win.`,
    ``,
    `<answer>`,
    answer,
    `</answer>`,
  ].join('\n')
}

/**
 * Opens the pane on the row's report, writing the report when there is none yet.
 * The pane is opened before anything is awaited, while the press still runs: a
 * pane opened unasked waits undrawn on a terminal under 144 columns.
 */
function showReport($: EngineInterface, id: string, languageOption: string) {
  void $.ui.open({ id: PANE, title: 'Report' }).then(
    opened => {
      if (!opened.isPlaced) $.ui.toast(`Report pane not shown: ${opened.reason}`)
    },
    (err: unknown) => $.ui.toast(`Report pane not opened: ${err instanceof Error ? err.message : String(err)}`),
  )
  void writeReport($, id, languageOption)
}

async function writeReport($: EngineInterface, id: string, languageOption: string) {
  await update($, selected, () => id)
  if (running.has(id)) return
  running.add(id)
  try {
    if ((await read($, { ...reports, id }))?.status === 'done') return
    const answer = await read($, { ...answers, id })
    if (!answer) return
    await update($, { ...reports, id }, (): Report => ({ status: 'pending' }))
    const prompt = reportPrompt(answer, await reportLanguage($, languageOption))
    const startedAt = await $.clock.now()
    const r = await $.model.fork({ prompt })
    const durationMs = (await $.clock.now()) - startedAt
    const next: Report = r.isAnswered
      ? {
          status: 'done',
          text: r.text,
          durationMs,
          ...(r.effort ? { effort: r.effort } : {}),
          usage: {
            input: r.usage.input_tokens,
            output: r.usage.output_tokens,
            cacheRead: r.usage.cache_read_input_tokens,
            cacheWrite: r.usage.cache_creation_input_tokens,
          },
        }
      : { status: 'failed', error: r.reason === 'api-error' && 'status' in r && r.status ? `api-error ${r.status}` : r.reason }
    await update($, { ...reports, id }, () => next)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await update($, { ...reports, id }, (): Report => ({ status: 'failed', error }))
  } finally {
    running.delete(id)
  }
}

function subjectOf(answer: string, columns: number): string {
  const line = (answer.split('\n').find(l => l.trim()) ?? '').replace(/^[\s#>*+\-\d.]+/, '').trim()
  const room = Math.max(10, columns - 4)
  return `On: ${line.length > room ? `${line.slice(0, room - 1)}…` : line}`
}

const count = (n: number) => n.toLocaleString('en-US')

export const register: Register = (on, options) => {
  const languageOption = typeof options.language === 'string' ? options.language : ''

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId || e.reason !== 'answer' || !e.answer.trim()) return r
    const id = rowIdOf(e.turnId)
    await update($, { ...answers, id }, () => e.answer)
    await $.ui.place({ id })
    return r
  })

  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== 'cc-report') return next(e)
    // The terminal reports clicks on transcript rows only in fullscreen.
    if (e.surface === 'terminal' && e.viewport?.isFullscreen === false) return next(e)
    const id = e.props.id
    const report = await read($, { ...reports, id })
    const { Box, Button, Text } = $.ui.resolve(e)
    if (report?.status === 'pending' && running.has(id)) {
      return (
        <Box paddingLeft={2}>
          <Text dimColor>⋯ writing report…</Text>
        </Box>
      )
    }
    const label = report?.status === 'done' ? 'show report' : report ? 'retry report' : 'report'
    return (
      <Box paddingLeft={2} flexDirection="row">
        <Button key="report" plain onPress={() => showReport($, id, languageOption)}>
          <Text dimColor>▸ {label}</Text>
        </Button>
        {report?.status === 'failed' ? (
          <Text color="error" dimColor>
            {' '}
            {report.error}
          </Text>
        ) : null}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const id = await read($, selected)
    if (!id) return <Text dimColor>Press "report" under an answer.</Text>
    const answer = (await read($, { ...answers, id })) ?? ''
    const report = await read($, { ...reports, id })
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text dimColor>{subjectOf(answer, e.props.bodyColumns)}</Text>
        {report?.status === 'done' ? (
          <Box flexDirection="column" rowGap={1}>
            <Markdown text={report.text} />
            <Text dimColor>
              took {Math.round(report.durationMs / 1000)}s{report.effort ? ` · effort ${report.effort}` : ''}
            </Text>
            <Text dimColor>
              cache read {count(report.usage.cacheRead)} · cache write {count(report.usage.cacheWrite)} · input{' '}
              {count(report.usage.input)} · output {count(report.usage.output)} tokens
            </Text>
          </Box>
        ) : report?.status === 'failed' ? (
          <Text color="error">Report failed: {report.error}</Text>
        ) : (
          <Text dimColor>Writing the report…</Text>
        )}
      </Box>
    )
  })
}
