---
name: test
description: Write and run Vitest tests for ToDoozy. Use when the user asks to write tests, add test coverage, test a specific function/repository/utility, or when a fix should include a regression test. Also triggers on "write tests", "add tests", "test coverage", "does this have tests", or similar.
---

# ToDoozy Test Skill

Write and run Vitest unit tests for repository methods, utility functions, and store logic in the ToDoozy Electron app.

## Project Test Setup

- **Framework:** Vitest (configured in `vitest.config.ts`)
- **Run all tests:** `npm run test`
- **Run specific file:** `npx vitest run src/main/repositories/repositories.test.ts`
- **Test files live next to source:** `TaskRepository.test.ts` alongside `TaskRepository.ts`
- **Database tests use in-memory SQLite:** `new Database(':memory:')` with migrations applied

## Existing Test Pattern

The project already has `src/main/repositories/repositories.test.ts` which establishes the pattern:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { migrations } from '../database/migrations'

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  for (const migration of migrations) {
    migration(db)
  }
  return db
}

function seedBase(db): { userId, projectId, statusId } {
  // Insert required FK dependencies (user, project, status)
}
```

Follow this pattern exactly. Reuse `createTestDb()` and `seedBase()` for all repository tests.

## What to Test

### Repository Methods (highest value)
These are pure database operations — easy to test, high impact:
- **TaskRepository:** create, update, delete, duplicate (with subtasks + labels), reorder, findSubtasks
- **LabelRepository:** create (order shifting), reorder, findByProjectId (order), delete
- **ThemeRepository:** create, update, delete, list, listByMode

### Utility Functions
Pure functions with no side effects:
- **DatePicker helpers:** `maskDateInput`, `maskTimeInput`, `isValidDate`, `toDate`, `formatIso`
- **Theme color inversion:** `invertLightness`, `generateCounterpartConfig`
- **Snooze presets:** `getSnoozePresets`

### What NOT to Test Here
- React components (need DOM environment + testing-library, separate concern)
- Zustand stores (depend on IPC bridge, need integration test setup)
- Visual/UI behavior (use `/audit` and `/screenshot` skills instead)

## How to Write a Test

### Step 1: Identify what changed
Read the recent git diff or the user's request to understand what needs tests.

### Step 2: Write the test file
Place it next to the source file. Follow the naming convention: `FileName.test.ts`.

### Step 3: Test structure
```typescript
describe('RepositoryName', () => {
  let db: Database.Database
  let repo: RepositoryClass
  let base: { userId: string; projectId: string; statusId: string }

  beforeEach(() => {
    db = createTestDb()
    repo = new RepositoryClass(db)
    base = seedBase(db)
  })

  describe('methodName', () => {
    it('describes the expected behavior', () => {
      // Arrange
      const input = { ... }

      // Act
      const result = repo.methodName(input)

      // Assert
      expect(result).toBeDefined()
      expect(result.field).toBe(expectedValue)
    })

    it('handles edge case', () => {
      // ...
    })
  })
})
```

### Step 4: Run and verify
```bash
npm run test
```
Fix any failures before committing. All tests must pass.

## Test Quality Rules

- **Test behavior, not implementation.** Assert on return values and database state, not internal method calls.
- **Each test is independent.** Use `beforeEach` to create fresh database and repos. No shared mutable state between tests.
- **Descriptive names.** `it('duplicates subtasks with (copy) suffix')` not `it('test duplicate')`.
- **Cover edge cases.** Empty inputs, missing records, boundary conditions (first/last item in a list).
- **No `any` types.** Tests follow the same strict TypeScript rules as the rest of the codebase.
- **Clean assertions.** One logical assertion per test. Multiple `expect` calls are fine if they verify one behavior.
- **No mocking of the database.** Use real in-memory SQLite — the repository tests ARE integration tests against the real SQL.

## After Writing Tests

1. Run `npm run test` — all tests must pass
2. If a test reveals a bug, fix the code, not the test
3. Commit tests alongside the code they cover
4. When fixing a bug via `/fix`, add a regression test that would have caught it

## Utility Test Pattern

For pure functions that don't need a database:

```typescript
import { describe, it, expect } from 'vitest'
import { maskDateInput } from './DatePicker'

describe('maskDateInput', () => {
  it('auto-inserts slashes', () => {
    expect(maskDateInput('22032026')).toBe('22/03/2026')
  })

  it('handles partial input', () => {
    expect(maskDateInput('22')).toBe('22')
    expect(maskDateInput('220')).toBe('22/0')
  })

  it('strips non-numeric characters', () => {
    expect(maskDateInput('22/03/2026')).toBe('22/03/2026')
    expect(maskDateInput('abc')).toBe('')
  })

  it('limits to 8 digits', () => {
    expect(maskDateInput('220320261')).toBe('22/03/2026')
  })
})
```
