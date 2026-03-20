---
name: feature
description: Add a new feature to ToDoozy. Use when the user wants to add a new feature, capability, or enhancement. Triggers on "add a feature", "new feature", "I want to add", "build X", or similar. Runs grill-me to define the story, writes it to prd.json, and launches ralph to implement it.
---

# ToDoozy Feature Skill

You are adding a new feature to ToDoozy. This skill defines the story through a structured interview, writes it to prd.json, and launches ralph to implement it autonomously.

## Phase 1: Define the Story

Invoke the `/grill-me` skill with the following prompt:

> Interview me about a new feature for ToDoozy (an Electron + React + TypeScript task manager). Your goal is to produce a complete user story with these three outputs:
>
> 1. **Title** — concise feature name (e.g., "Bulk task selection")
> 2. **Description** — detailed implementation guide covering: what it does, why it exists, user flow, interactions, keyboard shortcuts, which views/components are affected
> 3. **Acceptance Criteria** — concrete list of "done" conditions that an autonomous agent can verify without asking questions
>
> You MUST ensure all of these areas are covered before finishing:
> - What does this feature do?
> - What problem does it solve?
> - How does the user interact with it? (step-by-step flow, keyboard shortcuts)
> - Where does it live in the app? (which views, components, panels)
> - What are the edge cases? (empty states, errors, conflicts with existing features)
> - How do you know it's complete? (specific, testable criteria)
>
> Do NOT stop until you have enough detail for an autonomous agent to implement this feature without asking any clarifying questions.

If the user provided a feature idea in their `/feature` invocation, pass it along as context to grill-me.

When grill-me completes, extract the `title`, `description`, and `acceptance_criteria` from the conversation.

---

## Phase 2: Confirm the Story

Present the story to the user in this format:

```
### Story: <title>

**Description:**
<description>

**Acceptance Criteria:**
- <criterion 1>
- <criterion 2>
- ...
```

Ask: "Does this story look right? Any changes before I add it?"

Wait for confirmation. Apply any edits the user requests.

---

## Phase 3: Housekeeping — Archive Completed Stories

Before writing the new story, check prd.json for any stories with `passes: true`.

If there are completed stories:

1. Read `implemented-stories.md` in the project root (create it if it doesn't exist)
2. For each `passes: true` story, append it to `implemented-stories.md` in this format:

```markdown
---

### #<id> — <title>
- **Description:** <description>
- **Spec Section:** <spec_section>
- **Acceptance Criteria:** <acceptance_criteria, if present>
- **Passes:** true
- **Implemented:** <today's date YYYY-MM-DD>
```

3. Remove those stories from prd.json's `stories` array

---

## Phase 4: Branch

1. Generate a slug from the title (e.g., "Bulk task selection" -> `bulk-task-selection`)
2. Create a new branch: `git checkout -b ralph/<slug>`
3. Update prd.json's `branchName` field to `ralph/<slug>`

---

## Phase 5: Write the Story

Add the new story to prd.json's `stories` array:

```json
{
  "id": "<next sequential ID>",
  "title": "<title from grill-me>",
  "description": "<description from grill-me>\n\nBefore marking passes: true: read ui-reference.md and debug-learnings.md. Write tests for any new repository methods or utility functions. Run npm run test — all existing and new tests must pass. Run npm run typecheck — zero errors.",
  "spec_section": "N/A",
  "acceptance_criteria": ["<from grill-me>"],
  "passes": false
}
```

The description footer is mandatory. It ensures ralph reads the reference files, writes tests, and verifies before marking the story done.

---

## Phase 6: Commit

Stage prd.json and implemented-stories.md (if changed). Commit:

```
feat: add story #<id> — <title>
```

---

## Phase 7: Add Another?

Ask the user: "Would you like to add another feature?"

- **Yes** — go back to Phase 1
- **No** — continue to Phase 8

---

## Phase 8: Launch Ralph

Tell the user: "Ready to launch ralph to implement this. Starting `./ralph.sh --tool claude 3`."

Run:
```bash
./ralph.sh --tool claude 3
```

Wait for ralph to complete.

---

## Phase 9: Push

After ralph finishes, ask the user: "Ralph is done. Want me to push `ralph/<slug>` to origin?"

- **Yes** — run `git push -u origin ralph/<slug>`
- **No** — tell the user the branch is local and ready for review

---

## Rules

- Never skip the grill-me phase. A vague story produces a bad implementation.
- Always confirm the story with the user before writing it.
- Always archive completed stories before adding new ones.
- Always branch. Never add features directly to main.
- The description footer (ui-reference, debug-learnings, tests, typecheck) is mandatory on every story.
- Ralph runs with `--tool claude 3`. Do not change the iteration count.
- Ask before pushing. Never push automatically.
