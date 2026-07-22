/**
 * AppleScript source for the dev-mode macOS notification.
 *
 * The notification body and title are read from `argv` at runtime — they are NEVER
 * interpolated into this script text. Because the values arrive as discrete runtime
 * arguments rather than as part of the source, hostile characters in a task title
 * (double quotes, backslashes, backticks, or AppleScript metacharacters such as
 * `" & do shell script "…" & "`) cannot break out of the string context or inject code.
 */
export const DEV_NOTIFICATION_APPLESCRIPT =
  'on run argv\n' + 'display notification (item 1 of argv) with title (item 2 of argv)\n' + 'end run'

export interface DevNotificationCommand {
  command: string
  args: string[]
}

/**
 * Build the argv-based `osascript` command that shows a dev-mode notification on macOS.
 *
 * Injection-proof by construction: `title` and `body` are returned as discrete process
 * arguments (never concatenated into the script or a shell string). The caller runs them
 * with `execFileSync` — which spawns `osascript` directly, with no intervening shell — and
 * `osascript` hands the trailing arguments to AppleScript via `argv`. As a result neither
 * the shell nor the AppleScript parser ever treats the title/body as source: they are inert
 * data. Exported so it can be unit-tested with hostile titles.
 *
 * Arg order matches `DEV_NOTIFICATION_APPLESCRIPT`: item 1 of argv = body, item 2 = title.
 */
export function buildDevNotificationCommand(title: string, body: string): DevNotificationCommand {
  return {
    command: 'osascript',
    args: ['-e', DEV_NOTIFICATION_APPLESCRIPT, body, title]
  }
}
