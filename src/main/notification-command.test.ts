import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  buildDevNotificationCommand,
  DEV_NOTIFICATION_APPLESCRIPT
} from './notification-command'

// Titles that would break out of the old interpolated osascript string and inject code.
const HOSTILE_TITLES = [
  'plain title',
  'has a "double quote" inside',
  'trailing backslash \\',
  'backtick `whoami` inside',
  'newline\nsecond line',
  'AppleScript break: " & do shell script "echo pwned" & "',
  'shell metas: $(echo hi); rm -rf / | cat & wait',
  'quotes and slashes: "\\"\\\\"',
  "single 'quotes' too",
  '"; display dialog "gotcha'
]

describe('buildDevNotificationCommand', () => {
  it('spawns osascript with an -e script and no shell', () => {
    const { command, args } = buildDevNotificationCommand('Task', 'Due in 5 minutes')
    expect(command).toBe('osascript')
    expect(args[0]).toBe('-e')
    expect(args[1]).toBe(DEV_NOTIFICATION_APPLESCRIPT)
    // Exactly: -e, script, body, title. No shell string, no concatenation.
    expect(args).toHaveLength(4)
  })

  it('reads body and title from argv, never interpolating them into the script', () => {
    // The script is a fixed AppleScript program that pulls its values from `argv`.
    expect(DEV_NOTIFICATION_APPLESCRIPT).toContain('on run argv')
    expect(DEV_NOTIFICATION_APPLESCRIPT).toContain('item 1 of argv') // body
    expect(DEV_NOTIFICATION_APPLESCRIPT).toContain('item 2 of argv') // title
    expect(DEV_NOTIFICATION_APPLESCRIPT).toContain('display notification')
  })

  it('passes body as argv item 1 and title as argv item 2', () => {
    const { args } = buildDevNotificationCommand('MY_TITLE', 'MY_BODY')
    // args = ['-e', SCRIPT, body, title]
    expect(args[2]).toBe('MY_BODY')
    expect(args[3]).toBe('MY_TITLE')
  })

  it('keeps the script source constant regardless of input (no interpolation growth)', () => {
    const a = buildDevNotificationCommand('short', 'x')
    const b = buildDevNotificationCommand('a very '.repeat(500) + 'long title', 'y')
    expect(a.args[1]).toBe(b.args[1])
    expect(a.args[1]).toBe(DEV_NOTIFICATION_APPLESCRIPT)
  })

  describe.each(HOSTILE_TITLES)('hostile title: %j', (title) => {
    it('appears verbatim as a discrete argv element', () => {
      const { args } = buildDevNotificationCommand(title, 'Due in 1 minute')
      // The title is one whole argument, byte-for-byte unchanged (not escaped, not split).
      expect(args[3]).toBe(title)
    })

    it('is never embedded in the AppleScript source', () => {
      const { args } = buildDevNotificationCommand(title, 'Due in 1 minute')
      const script = args[1]
      // The dangerous part of an injection would only fire if the payload were part of the
      // script text. It must not be — the script is the fixed argv-reading program.
      expect(script).toBe(DEV_NOTIFICATION_APPLESCRIPT)
      if (title.length > 3) {
        expect(script).not.toContain(title)
      }
    })
  })
})

// End-to-end proof that osascript's argv mechanism treats the hostile title as inert data.
// Runs the identical argv-passing path used by the real command but with a verification script
// that returns argv (instead of `display notification`, which would pop UI during tests).
describe.skipIf(process.platform !== 'darwin')('osascript argv is injection-proof (darwin)', () => {
  it('returns a hostile title literally and runs no embedded shell payload', () => {
    const sentinel = join(tmpdir(), `todoozy-notif-injection-${process.pid}-${Date.now()}.txt`)
    rmSync(sentinel, { force: true })

    // A title whose payload, if interpreted as AppleScript source, would create the sentinel.
    const payload = `pwn " & do shell script "touch '${sentinel}'" & "`
    const echoArgvScript = 'on run argv\nreturn item 1 of argv\nend run'

    const out = execFileSync('osascript', ['-e', echoArgvScript, payload], { encoding: 'utf8' })

    expect(out.trim()).toBe(payload) // returned literally, unparsed
    expect(existsSync(sentinel)).toBe(false) // no shell script executed
    rmSync(sentinel, { force: true })
  })
})
