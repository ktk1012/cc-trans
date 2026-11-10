export type View = 'auto' | 'stacked' | 'interleave' | 'side' | 'mirror' | 'below' | 'translated' | 'peek' | 'original'

/** One reply block's translation, keyed by a hash of the block's text. */
export type ReplyEntry = {
  status: 'pending' | 'done' | 'failed' | 'skipped'
  /** Restored translations per unit of planMarkdown(text); null where a unit failed. */
  out: (string | null)[]
  engine: string
  error?: string
}

/** A prompt sent in English, keyed by a hash of the English text. */
export type PromptEntry = { native: string; engine: string }

/** The live preview of the draft. */
export type Preview = { draft: string; english: string | null; status: 'pending' | 'done' | 'failed'; engine: string }

declare module 'claude-code' {
  interface PluginState {
    'cc-trans': {
      enabled: boolean
      view: View | null
      reply: StateFamily<ReplyEntry | null>
      /** Whether the peek view shows a reply block in English, by its row id and text hash. */
      reveal: StateFamily<boolean | null>
      /** An AskUserQuestion dialog's texts in the person's language, by a hash of its question texts. */
      ask: StateFamily<Record<string, string> | null>
      prompt: StateFamily<PromptEntry | null>
      preview: Preview | null
      queued: number
    }
  }
}
