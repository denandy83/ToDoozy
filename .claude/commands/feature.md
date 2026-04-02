---
name: feature
description: Add a new feature to ToDoozy. Use when the user wants to add a new feature, capability, or enhancement. Triggers on "add a feature", "new feature", "I want to add", "build X", or similar. Runs grill-me to define the story, writes it to prd.json, and launches ralph to implement it.
---

# ToDoozy Feature Skill

You are adding a new feature to ToDoozy. This skill defines the story through a structured interview, writes it to prd.json, and launches ralph to implement it autonomously.

## Phase 0: Check scope.md

Before starting, read `scope.md` in the project root. If it exists and covers the feature area, use that context instead of re-exploring. If it doesn't exist or doesn't cover this area, you'll create/update it during investigation.

---

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

Before writing the new story, check prd.json for any stories with `passes: true` AND `tested: true`.

If there are completed and tested stories:

1. Read `implemented-stories.md` in the project root (create it if it doesn't exist)
2. For each `passes: true` AND `tested: true` story, append it to `implemented-stories.md` in this format:

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

## Phase 4: Write the Story

Add the new story to prd.json's `stories` array **on the current branch** (do NOT create a new branch yet):

```json
{
  "id": "<next sequential ID>",
  "title": "<title from grill-me>",
  "description": "<description from grill-me>\n\nBefore marking passes: true: read ui-reference.md and debug-learnings.md. Write tests for any new repository methods or utility functions. Run npm run test — all existing and new tests must pass. Run npm run typecheck — zero errors.",
  "spec_section": "N/A",
  "acceptance_criteria": ["<from grill-me>"],
  "passes": false,
  "tested": false
}
```

The description footer is mandatory. It ensures ralph reads the reference files, writes tests, and verifies before marking the story done.

Do NOT commit yet — wait until the user is done adding stories.

---

## Phase 5: Add Another?

Ask the user: "Would you like to add another feature?"

- **Yes** — go back to Phase 1
- **No** — continue to Phase 6

---

## Phase 6: Branch, Commit, and Launch Ralph

Now that all stories are defined:

1. Generate a branch name from the stories. If one story, use its slug (e.g., `ralph/bulk-task-selection`). If multiple stories, use a general name (e.g., `ralph/features-20-21-22`).
2. Create the branch: `git checkout -b ralph/<name>`
3. Update prd.json's `branchName` field to `ralph/<name>`
4. Stage prd.json and implemented-stories.md (if changed). Commit:
   ```
   feat: add stories #<ids> — <brief summary>
   ```
5. Tell the user: "Ready to launch ralph to implement these stories. Starting `./ralph.sh --tool claude 3`."
6. Run:
   ```bash
   ./ralph.sh --tool claude 3
   ```

Wait for ralph to complete.

---

## Phase 7: Testing

After ralph finishes, the stories have `passes: true` but `tested: false`. For each story that has a corresponding ToDoozy task, move it to Testing status (`26686d55-1cfb-4fcd-ad19-674436b2392f`) via MCP.

Testing is done by the user:

1. Tell the user: "Ralph is done. Let's test the implementation. Here are the acceptance criteria to verify:"
2. For each story, list all acceptance criteria as a numbered checklist.
3. Walk through each criterion with the user. Ask them to verify each one. If a criterion fails, use `/fix` to address it.
4. Once the user confirms ALL acceptance criteria pass, update prd.json to set `tested: true` for the story.
5. Move the corresponding ToDoozy task to Done (`6c3b0144-8629-486f-8b10-d9fc4e5c35f5`) via MCP.
6. Only stories with BOTH `passes: true` AND `tested: true` can be archived to implemented-stories.md.

Do NOT set `tested: true` until the user explicitly confirms all criteria are met.

---

## Phase 8: Push

After testing is complete, ask the user: "All stories tested and verified. Want me to push `ralph/<name>` to origin?"

- **Yes** — run `git push -u origin ralph/<name>`
- **No** — tell the user the branch is local and ready for review

---

## Phase 9: Update Documentation

After push (or after testing if not pushing), update the documentation for every story that reached `tested: true` in this session:

### 9a — Append to pending-changes.md

For each verified story, append a full entry to `pending-changes.md` so a cold session has everything it needs to update docs without re-reading the code:

```
## <YYYY-MM-DD> — Feature: <title>
**What it does:** <what the user can now do — concrete, user-facing>
**Why it was built:** <the problem it solves>
**How to use it:** <brief user-facing instructions — 2-4 sentences>
**Technical summary:** <what was added: key components, stores, IPC handlers, DB changes>
**Acceptance criteria met:** <bullet list from the story>
**Affected views/components:** <list>
**Commit:** <commit hash>
```

### 9b — Update RELEASE_NOTES.md

Open `RELEASE_NOTES.md`. Under the current version heading (read version from `package.json`; create it if it doesn't exist, at the top), add a bullet for each new feature:

```markdown
## vX.Y.Z

- **Feature title** — User-facing description of what this enables.
```

### 9c — Update FEATURES.md

Add or update the relevant section in `FEATURES.md` to reflect the new feature. Include: what it does, how it works technically, and mark status as Complete with the date.

### 9d — Update README.md feature table

If the feature is significant enough to be in the README feature table, add a row. Keep descriptions to one line.

### 9e — Append to DEVLOG.md

Add a session entry at the top of `DEVLOG.md`:

```markdown
## <YYYY-MM-DD> — Feature: <title>

**Stories implemented:** #<ids>
**Branch:** <branch name>
**What was built:** <brief summary>
**Decisions:** <any notable choices made during implementation>
```

### 9f — Update scope.md

After implementation is complete, update `scope.md`:
- Mark implemented items as done
- If the feature revealed new codebase knowledge relevant to other scope items, update those
- If all scope items are done, clear the file

### 9g — Update in-app "What's New"

Update the `whats_new` global setting (user_id `''`) in the SQLite database with all user-facing changes under the current version header (read version from `package.json`). All items are flat bullets under `## vX.Y.Z` — no category sub-headers. Replace the full value each time.

```bash
DB_PATH="$HOME/Library/Application Support/todoozy/todoozy.db"
sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO settings (user_id, key, value) VALUES ('', 'whats_new', '<version header + all bullets>');"
```

### 9h — Update HELP.md

Update `HELP.md` (the end-user guide) with documentation for any new user-facing feature. Match the existing style: `## Section` headers with descriptive paragraphs. If the feature fits in an existing section, add to it. If it's a new area, add a new section in a logical location. Also update the corresponding help data in `src/renderer/src/features/help/HelpSettingsContent.tsx` — add entries to the `HELP_SECTIONS` array and shortcut data as needed so the in-app help stays in sync.

### 9i — Clear pending-changes.md entries

After all docs are updated, remove the entries you just processed from `pending-changes.md` (keep the header and format instructions). Write the current HEAD commit hash to `.last-documented-commit`.

---

## Rules

- Never skip the grill-me phase. A vague story produces a bad implementation.
- Always confirm the story with the user before writing it.
- Always archive completed stories before adding new ones.
- Do NOT create branches or commit until the user is done adding all stories and says "no" to adding another.
- The description footer (ui-reference, debug-learnings, tests, typecheck) is mandatory on every story.
- Ralph runs with `--tool claude 3`. Do not change the iteration count.
- Ask before pushing. Never push automatically.
- `implemented-stories.md` is permanent — never delete entries from it.
- Documentation updates (Phase 9) are mandatory after every verified story, not optional.
