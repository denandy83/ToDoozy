---
name: fix
description: Structured fix workflow for ToDoozy — handles both code bugs and UI issues. Use this whenever the user reports something broken, not working, visually wrong, or asks to fix/debug/investigate anything. Triggers on "this isn't working", "it broke", "fix this", "looks wrong", "spacing is off", "why is X happening", UI inconsistencies, runtime errors, or any unexpected behavior. Also invoked by /audit when the user chooses to fix an issue.
---

# ToDoozy Fix Skill

You are fixing an issue in ToDoozy, an Electron + React + TypeScript app with Zustand stores, SQLite via better-sqlite3, and IPC between main/renderer processes. This skill handles both code bugs and visual/UI issues. Rushing to a fix without understanding the problem wastes time — a methodical approach gets you there faster.

## Before You Start: Read the Learnings

Check whether this bug matches a known pattern before investigating from scratch:

- Read `debug-learnings.md` in the project root — code bug patterns (Zustand re-renders, missing JOINs, hydration issues)
- Read `ui-learnings.md` in the project root — visual fix patterns (spacing calculations, component sizing)
- If the issue is visual, also read `ui-reference.md` — the design spec for colors, typography, spacing, components

If any of these files don't exist yet, skip them.

---

## Phase 1: Understand the Issue (Do This First, Every Time)

**Skip this phase if you're being called from another skill that already identified the issue — look for a `--from-audit` or `--skip-interview` flag in the invocation.**

Before looking at code, before touching git, before doing anything — talk to the user. Your goal is to fully understand what's wrong from their perspective. You cannot fix what you don't understand.

Ask questions until you can confidently explain the issue back to the user and they say "yes, that's it." Don't settle for a vague understanding.

Things you need to know:
- **What's the exact behavior?** What do they see/experience? Get specifics.
- **What's the expected behavior?** What should happen instead?
- **How to reproduce it.** Step by step. Which view? Which action? Which data?
- **When did it start?** Did it ever work? Did it break after a recent change?
- **Error messages?** Anything in the console, terminal, or on screen?
- **Screenshots?** If it's visual, ask for one — or use `/screenshot` to capture the current state yourself.

Keep asking follow-up questions. If something is ambiguous, clarify it. Do NOT proceed until you and the user are on the same page.

Once you understand the issue, summarize it back to the user in 2-3 sentences and ask them to confirm.

### Determine the Issue Type

Based on the interview, classify the issue:

- **Code bug** — runtime error, data not flowing, logic broken, crash. You'll use `debug-learnings.md` and diagnostic logging.
- **UI issue** — visual inconsistency, wrong spacing, colors off, layout broken, doesn't match design spec. You'll use `ui-reference.md` and `ui-learnings.md` and do cross-view consistency checking.
- **Both** — a code fix that also caused a visual regression, or a visual issue with a code root cause. You'll use all three reference files.

You don't need to announce this decision — just pull in the right context silently.

### Take a "Before" Screenshot

Use `/screenshot` to capture the current state. This documents the issue and gives you a baseline for comparison later.

---

## Phase 2: Secure the Workspace

**Skip this phase if you're already on a fix/debug branch from another skill invocation.**

Protect the current state before changing any code.

1. Run `git status`. If there are uncommitted changes:
   - Tell the user: "There are uncommitted changes. I'll commit these first so nothing gets lost."
   - Stage and commit with a message like `wip: save state before fix [brief issue description]`

2. Note the current branch and HEAD commit — this is your **safe point**.

3. Create a fix branch:
   ```
   git checkout -b fix/<short-description>
   ```
   Use a descriptive slug like `fix/label-picker-overflow` or `fix/sidebar-badge-position`.

4. Tell the user: "Created branch `fix/<name>` from `<original-branch>` at `<commit-hash>`. All work happens here — your original branch is untouched."

---

## Phase 3: Investigate

Do NOT write any code yet. Build a theory of what's wrong.

### For Code Bugs

**Read the error carefully.** If there's a stack trace, follow it. If the user described behavior, think about what produces that result.

**Trace the data flow.** ToDoozy's architecture is:
- SQLite DB → Repository classes (`src/main/repositories/`) → IPC handlers (`src/main/ipc/`) → Preload bridge (`src/preload/`) → Zustand stores (`src/renderer/src/stores/`) → React components (`src/renderer/src/features/`)

Most bugs live at a boundary between these layers. Figure out which layer the bug is in.

**Gather evidence.** Read the relevant source files. Check recent git history for the area (`git log --oneline -10 -- <file>`). Look for related code that might be affected.

#### Diagnostic Logging

If reading the code isn't enough, add targeted `console.log` or `console.error` statements:

1. Add diagnostic logs at key points (store selectors, IPC handlers, event callbacks)
2. Kill the existing dev server and restart:
   ```bash
   pkill -9 -f "Electron.app" 2>/dev/null; pkill -f "electron-vite" 2>/dev/null; lsof -ti:5200 | xargs kill -9 2>/dev/null; sleep 1
   npm run dev &
   ```
3. Wait for the app to load (~5 seconds)
4. Tell the user exactly how to reproduce the issue so the logs fire
5. After they've reproduced it, use `/screenshot` with DevTools open to capture the console output
6. Read and interpret the logs

Repeat as needed. Keep track of every diagnostic log you add — they all get removed before the final commit.

### For UI Issues

**Cross-reference with `ui-reference.md`.** Every visual element should trace back to a rule in that document. Find the gap between what's rendered and what the spec says.

**Measure precisely.** Combine what you see in the screenshot (visual gaps, alignment, overflow) with what you read in the code (pixel values, padding, width, Tailwind classes). Reason about exact numbers:
- Read the component code to find the popup/element's dimensions
- Look at the container's constraints
- Calculate the exact space needed rather than guessing

**Check cross-view consistency.** If the component you're fixing appears in multiple places (TaskRow, KanbanCard, DetailPanel, ContextMenu), read all of them. The fix must be consistent everywhere.

**Check for shared components.** Before changing anything, verify you're using the shared component if one exists:
- Status → `StatusButton`
- Priority → `PriorityIndicator` / `PriorityBadge`
- Labels → `LabelChip` / `LabelPicker`
- Dates → `DatePicker`
- Overlays → `Modal`
- Notifications → `Toast`
- Right-click → `ContextMenu`
- Filtering → `LabelFilterBar`

If someone rebuilt functionality that a shared component already handles, replacing it with the shared component is the fix.

### Form a Hypothesis

Before proposing any fix, state clearly:
- What you believe is happening
- Why you believe it (cite specific lines of code or measurements)
- What the fix should be
- What else might be affected (blast radius)

Present this to the user and get confirmation before proceeding.

---

## Phase 4: Fix — One Surgical Change at a Time

Make the **minimal change** that addresses the root cause.

**For UI fixes specifically:**
- Typography: only use classes from the typography scale in `ui-reference.md`
- Colors: only use theme tokens — never hardcode hex (except priority/label accent colors)
- Spacing: match the spacing reference table
- Animations: always wrap in `motion-safe:`
- Icons: `lucide-react` only, 14px default, stroke 1.5
- Hover states: always `hover:bg-foreground/6`

After applying the fix:

1. Run `npm run typecheck` — fix any type errors before moving on
2. Kill the existing dev server and restart:
   ```bash
   pkill -9 -f "Electron.app" 2>/dev/null; pkill -f "electron-vite" 2>/dev/null; lsof -ti:5200 | xargs kill -9 2>/dev/null; sleep 1
   npm run dev &
   ```
3. Wait for the app to load, then use `/screenshot` to capture the result (both UI and DevTools console)
4. Analyze the screenshot yourself:
   - **Code bugs:** Is the error gone? Any new errors in console?
   - **UI issues:** Does it match the spec? Are measurements correct? Check surrounding elements for collateral damage.
5. If it's a UI fix, ask the user to navigate to other views where the same component appears — screenshot those too for cross-view verification
6. Tell the user what to test and ask them to confirm whether the fix works

Wait for the user's confirmation. Do not assume success.

---

## Phase 5: Handle Failure

If the fix didn't work or only partially worked, ask the user:

> "That didn't fully fix it. Was this change helpful/on the right track, or should I throw it away and try a different approach?"

### "It's progress — keep going"
Continue building on the current changes. Go back to Phase 3 with the new information, form a new hypothesis, and apply the next fix on top. Keep track of every file you've touched and what you changed.

### "Dead end — try something else"
Reset the fix branch to the safe point:
```
git reset --hard <safe-point-commit>
```
Go back to Phase 3 with fresh eyes. The failure is diagnostic — what does it rule out?

### Stuck after 3 failed attempts
Stop and tell the user:
- What you've tried and why each failed
- What you've learned about the problem
- What avenues remain unexplored
- Whether you think a different angle is needed

Don't spiral. Fresh eyes are more valuable than a 4th guess.

---

## Phase 6: Clean Up and Merge

Once the user confirms the issue is fully fixed:

### Remove diagnostic logging
If you added any `console.log` / `console.error` statements, grep for and remove all of them. Only remove ones you added.

### Forensic pass (if it took multiple rounds)
1. Run `git diff <original-branch>..HEAD` to see everything that changed
2. Classify each change:
   - **Essential** — directly contributed to the fix
   - **Incidental** — leftover from earlier attempts
3. Tell the user: "I changed X files, but I believe only these changes were necessary: [list]. Want me to clean up and keep only the essential changes?"
4. If the user agrees, reset and re-apply only what matters

### Take an "After" screenshot
Use `/screenshot` to capture the fixed state. Compare against the "before" screenshot and confirm the issue is resolved.

### Verify
Run `npm run typecheck` one final time.

### Squash merge
```bash
git checkout <original-branch>
git merge --squash fix/<name>
git commit -m "<conventional commit message describing the fix>"
```

Ask the user if they want to delete the fix branch:
```
git branch -D fix/<name>
```

### Update Learnings

**For code bugs** — if this revealed a reusable pattern, append to `debug-learnings.md`:
- **Pattern name** — short, searchable
- **Symptoms** — what the bug looked like
- **Root cause** — what was actually wrong
- **Fix** — what solved it
- **Check first** — what to look for next time

**For UI issues** — append to `ui-learnings.md`:
- **Pattern name** — short, searchable
- **What it looked like** — the visual symptom
- **Root cause** — wrong class, missing token, hardcoded value, etc.
- **Fix** — exact classes/values used
- **Measurement notes** — any precise calculations for future reference

**If the design spec changed** — update `ui-reference.md` to reflect the new design decision. Only do this if the fix represents a deliberate design change, not just a correction.

### Check for UI regressions

After the fix is merged, use `/screenshot` one more time and analyze the result. If you notice any visual inconsistency introduced by the fix (even in areas you didn't directly touch), flag it to the user and offer to fix it — either directly if it's trivial, or by continuing on the current branch.

### Update Changelog

Append an entry to `pending-changes.md` using the full format so a cold session has everything it needs:

```
## <YYYY-MM-DD> — Fix: <short title>
**What was broken:** <what the user experienced — specific, user-facing language>
**Root cause:** <what was actually wrong in the code — one sentence>
**What was fixed:** <what changed and how it resolves the issue>
**User-facing impact:** <what the user now experiences — one sentence>
**Affected area:** <view/component/feature>
**Files changed:** <key files modified>
**Commit:** <commit hash from the squash merge>
```

Then append to `CHANGELOG.md` under today's date (create the heading if it doesn't exist):

```markdown
## YYYY-MM-DD

### Fixed
- **<Short title>** — <User-facing description of what was broken and what the fix does>
```

If the fix affects something the user interacts with directly (not an internal refactor), also add a bullet to today's entry in `RELEASE_NOTES.md`:

```markdown
## YYYY-MM-DD

- **Fix: <short title>** — <What changed for the user>
```

Finally, write the current HEAD commit hash to `.last-documented-commit` to sync the Stop hook marker.

---

## Rules

- **Never guess.** If you're not sure, ask the user or read more code. Reading 5 files is cheaper than 3 failed attempts.
- **One change at a time.** One logical change with one clear rationale. No "while I'm here" improvements.
- **Typecheck is mandatory.** Every fix must pass `npm run typecheck`.
- **The user is the tester.** You verify it compiles and looks right; they verify it works. Always ask.
- **Protect the tree.** Always work on a fix branch. Uncommitted work gets committed first.
- **Always ask before rolling back.** Never revert without the user's input.
- **Understand first, fix second.** Phase 1 is not optional.
- **Kill before restarting.** Always kill existing dev server before `npm run dev`.
- **Clean up after yourself.** Remove all diagnostic logging before the final commit.
- **Learn from every fix.** Update the relevant learnings file.
- **Document every fix.** Update CHANGELOG.md and pending-changes.md — this is mandatory, not optional.
- **Measure, don't guess.** For UI issues, combine screenshot analysis with code measurements for precise fixes.
- **Cross-view consistency.** If a component appears in multiple places, check all of them.
