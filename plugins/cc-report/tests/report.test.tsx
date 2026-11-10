import { expect, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const ANSWER = 'Fixed the N+1 in `loadUsers` (users.js:12). Tests pass.'
const REPORT = '## 결과\n\n`loadUsers`의 N+1 쿼리를 고쳤습니다.'
const USAGE = { input_tokens: 40, output_tokens: 300, cache_read_input_tokens: 52000, cache_creation_input_tokens: 0 }

const row = (isFullscreen: boolean) =>
  ({
    plugin: 'cc-report',
    surface: 'terminal',
    component: 'Placed',
    requestId: 'row-1',
    props: { id: 'tturn-1', plugin: 'cc-report' },
    viewport: { columns: 160, rows: 40, isFullscreen },
  }) as never

const PANE = {
  plugin: 'cc-report',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'report',
  props: { title: 'Report', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as never

type Fork = { isAnswered: true; text: string; usage: typeof USAGE; effort?: string } | { isAnswered: false; reason: string }
type Opened = { isPlaced: true } | { isPlaced: false; reason: string }

/** Stands for the engine beneath the plugin, recording what it is asked. */
function engine(
  on: On,
  {
    fork = { isAnswered: true, text: REPORT, usage: USAGE, effort: 'xhigh' },
    opened = { isPlaced: true },
  }: { fork?: Fork; opened?: Opened } = {},
) {
  // The fork starts at 1s and ends at 43s.
  const times = [1_000, 43_000]
  on('clock.now', () => ({ value: times.shift() ?? 43_000 }))
  const placed: string[] = []
  const prompts: string[] = []
  const opens: string[] = []
  const toasts: string[] = []
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.place', (_$, e) => {
    placed.push(e.id)
    return { value: { isPlaced: true as const, requestId: `row-${placed.length}` } }
  })
  on('ui.open', (_$, e) => {
    opens.push(e.id)
    return { value: opened }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('model.fork', (_$, e) => {
    prompts.push(e.prompt)
    return { value: fork as never }
  })
  return { placed, prompts, opens, toasts }
}

const finish = ($: Engine, turn: Record<string, unknown> = {}) =>
  $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId: 'turn-1', reason: 'answer', ...turn } as never)

test('a report row under an answer forks once and shows the report in the pane', { options: { language: 'ko' } }, async ($, on) => {
  const { placed, prompts, opens, toasts } = engine(on)
  await finish($)
  expect(placed).toEqual(['tturn-1'])

  const ui = await $.ui.mount(row(true))
  await ui.press({ key: 'report' })
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain(`<answer>\n${ANSWER}\n</answer>`)
  expect(prompts[0]).toContain('Write the report in Korean,')
  // shown again from what was written, not forked again
  await ui.press({ key: 'report' })
  expect(prompts).toHaveLength(1)
  expect(opens).toEqual(['report', 'report'])
  expect(toasts).toEqual([])
  await ui.unmount()

  const pane = await $.ui.mount(PANE)
  expect((await pane.find({ type: 'Markdown' }))?.text).toBe(REPORT)
  expect((await pane.find({ type: 'Text', text: /^On:/ }))?.text).toBe('On: Fixed the N+1 in `loadUsers` (users.js:12). Tests pass.')
  expect((await pane.find({ type: 'Text', text: /cache read/ }))?.text).toBe(
    'cache read 52,000 · cache write 0 · input 40 · output 300 tokens',
  )
  expect((await pane.find({ type: 'Text', text: /^took/ }))?.text).toBe('took 42s · effort xhigh')
  await pane.unmount()
})

test('subagent turns, interrupted turns and empty answers get no report row', async ($, on) => {
  const { placed } = engine(on)
  await finish($, { turnId: 'a', agentId: 'agent-1' })
  await finish($, { turnId: 'b', reason: 'aborted', isAborted: true })
  await finish($, { turnId: 'c', answer: '  ' })
  expect(placed).toEqual([])
})

test('on the main screen, where clicks do not reach the row, it draws no button', async ($, on) => {
  engine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await finish($)
  const ui = await $.ui.mount(row(false))
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('a pane the surface does not place says why, and the report is still written', { options: { language: 'ko' } }, async ($, on) => {
  const reason = 'opened unasked: 144 columns needed, 120 now'
  const { prompts, toasts } = engine(on, { opened: { isPlaced: false, reason } })
  await finish($)
  const ui = await $.ui.mount(row(true))
  await ui.press({ key: 'report' })
  expect(toasts).toEqual([`Report pane not shown: ${reason}`])
  expect(prompts).toHaveLength(1)
  await ui.unmount()
})

test('a fork with nothing to fork leaves the reason on the row and a retry', { options: { language: 'ko' } }, async ($, on) => {
  const { prompts } = engine(on, { fork: { isAnswered: false, reason: 'nothing-to-fork' } })
  await finish($)
  const ui = await $.ui.mount(row(true))
  await ui.press({ key: 'report' })
  await ui.unmount()

  const again = await $.ui.mount(row(true))
  expect((await again.find({ type: 'Text', text: /nothing-to-fork/ }))?.text).toContain('nothing-to-fork')
  expect((await again.find({ type: 'Text', text: /retry report/ }))?.text).toBe('▸ retry report')
  await again.press({ key: 'report' })
  expect(prompts).toHaveLength(2)
  await again.unmount()
})
