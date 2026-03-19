---
name: audit
description: Visual audit of the current ToDoozy screen. Use this when the user wants to check the UI for inconsistencies, wants general visual improvement suggestions, or says things like "audit", "check the UI", "what looks off", "any visual issues", "review the design". Does NOT fix anything — only reports issues and asks the user what to do.
---

# ToDoozy UI Audit

You are auditing the current screen of ToDoozy for visual inconsistencies. Your job is to find issues, not fix them.

## Step 1: Load the Design Spec

Read these files:
- `ui-reference.md` — the design spec (colors, typography, spacing, components, interactions)
- `ui-learnings.md` — known visual patterns and past fixes (if it exists)

You need to know what "correct" looks like before you can spot what's wrong.

## Step 2: Capture the Current State

Use `/screenshot` to capture whatever is currently on screen. If the detail panel is open, capture that too. If a menu or picker is open, capture that state.

## Step 3: Analyze

Go through the screenshot systematically, checking every visible element against `ui-reference.md`:

**Typography**
- Is every text element using the correct tier from the typography scale?
- Are font weights, tracking, and sizes correct?
- Any text that doesn't match a defined tier?

**Colors**
- Are all colors coming from theme tokens?
- Any hardcoded colors that would break in other themes?
- Are opacity modifiers correct (hover at /6, selection at /12, etc.)?

**Spacing**
- Does padding match the spacing reference? (task rows: py-3.5 px-4, modals: p-10, etc.)
- Are gaps consistent between similar elements?
- Any elements too close together or too far apart?

**Components**
- Are shared components being used where they should be?
- Any custom implementations that should use StatusButton, LabelChip, PriorityBadge, etc.?
- Do components match their spec (correct props, correct styling)?

**Interaction States**
- Are hover states consistent (bg-foreground/6)?
- Selection state correct (bg-accent/12 + border-accent/15)?
- Focus indicators present on interactive elements?

**Layout**
- Are elements aligned properly?
- Any overflow or clipping issues?
- Does the layout flow naturally between sections/panes?
- Z-index correct for overlapping elements?

**Icons**
- All from lucide-react?
- Correct sizes (14px default)?
- Correct stroke width (1.5 standard, 2.5 done status)?

**Animations**
- Any animations missing the `motion-safe:` prefix?

## Step 4: Report

Present findings as a structured report. Categorize each issue by severity:

### Report Format

```
## UI Audit Report — [View Name]

### 🔴 Large (layout restructure, new component, significant rework)
- [Issue description + what it should look like per spec]

### 🟡 Medium (wrong values, missing states, inconsistent patterns)
- [Issue description + what it should look like per spec]

### 🟢 Small (minor spacing, opacity, single class fix)
- [Issue description + what it should look like per spec]
```

For each issue, include:
- What's wrong (reference the specific element)
- What it should be (reference the specific rule in `ui-reference.md`)
- How confident you are (sometimes a screenshot is ambiguous)

## Step 5: Ask the User

After presenting the report, ask:

> "Which of these would you like me to fix? For small issues I can fix them directly. For medium and large ones I'll run the full `/fix` workflow."

- **Small issues the user approves:** fix directly on the current branch, no need for a separate fix branch. Run typecheck, screenshot to verify, commit.
- **Medium/large issues:** invoke `/fix --skip-interview` with the issue description — the full branch + investigate + verify workflow.
- **Issues the user skips:** leave them. Don't push.

---

## Rules

- **Report only, don't fix unprompted.** The audit's job is to find and report. The user decides what gets fixed.
- **Be specific.** "The spacing looks off" is useless. "Task row padding is py-2 but spec says py-3.5" is actionable.
- **Reference the spec.** Every issue should point to a specific rule in `ui-reference.md`.
- **Don't nitpick beyond the spec.** If something isn't covered by the spec and looks fine, it's not an issue.
- **Group related issues.** If 5 task rows all have the same wrong padding, that's one issue, not five.
