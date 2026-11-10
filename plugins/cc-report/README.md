# cc-report

**Turn any answer into a short, sourced report, without touching the conversation.**

Under each answer Claude finishes, cc-report places a quiet `▸ report` row. Click it and a side pane shows
the answer audited for the reader: the bottom line first, each load-bearing claim with its source
(`path:line`, a command and its output, a URL) or a plain "no source in this session", the assumptions it
leaves unstated, and what was not verified.

```
/plugin install cc-report --marketplace ktk1012/cc-trans
```

## How it works

- The report is written by `$.model.fork`: the main thread's last request again, with one prompt appended
  at its end. The prefix (system prompt, tools, the whole conversation) is read from the prompt cache, and
  the fork runs on the session's own model.
- Nothing is written into the conversation. The row under the answer is display-only, and Claude never
  sees the report.
- The fork has no tools. It audits what the session has already seen; a claim the conversation holds no
  evidence for is marked as such instead of being filled in.
- The pane's last lines show how long the report took, the effort it ran at, and its token counts
  (`cache read` near the conversation's size means the cache was reused).

## Use it

- Click `▸ report` under an answer. While it is written the row says `⋯ writing report…`; then it turns
  into `▸ show report`, which reopens the pane without writing it again.
- Close the pane with its close mark or `ctrl+x x`.
- Clicks reach transcript rows only in the fullscreen terminal (and the desktop and mobile apps); on the
  terminal's main screen the row stays empty.

## Options

Set at install time, or under `pluginConfigs["cc-report"].options` in settings.

| Option | Default | |
| --- | --- | --- |
| `language` | empty | the report's language; empty follows Claude Code's `language` setting, then the system locale, else English |

## Cost

Each report is one request on the session's model: a cache read of the conversation plus the report's
output. A report asked for after the cache entry has lapsed pays for the whole conversation again.

## Development

```
claude --plugin-dir plugins/cc-report
claude plugin validate plugins/cc-report
claude plugin test plugins/cc-report
```
