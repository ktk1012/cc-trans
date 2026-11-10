export type ReportUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Report =
  | { status: 'pending' }
  | { status: 'done'; text: string; durationMs: number; effort?: string; usage: ReportUsage }
  | { status: 'failed'; error: string }

declare module 'claude-code' {
  interface PluginState {
    'cc-report': {
      /** A main-thread turn's final answer, by the id of the row placed under it. */
      answer: StateFamily<string | null>
      report: StateFamily<Report | null>
      /** The row whose report the pane shows. */
      selected: string | null
    }
  }
}
