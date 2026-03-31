# Make ToDoozy Distribution-Ready

## Phase 1: User-Scope All Data — DONE

### Completed:
- [x] Migration 11: settings table gets user_id composite key, themes table gets owner_id column
- [x] LabelRepository: findAll → findAllForUser(userId), findByName takes userId, findAllWithUsage takes userId, findProjectsUsingLabel takes userId
- [x] SettingsRepository: all methods take userId, falls back to global defaults (user_id='')
- [x] ThemeRepository: list/listByMode filter by is_builtin OR owner_id, create sets owner_id
- [x] ActivityLogRepository: getRecent scoped through project_members
- [x] TaskRepository: findAllTemplates scoped through project_members
- [x] ProjectTemplateRepository: findAll IPC now uses findByOwnerId
- [x] projects:list IPC now uses getProjectsForUser instead of unfiltered list()
- [x] All IPC handlers updated with userId parameters
- [x] Preload bridge types and implementation updated
- [x] settingsStore: stores userId, uses it in all API calls
- [x] labelStore, taskStore: get userId from authStore
- [x] templateStore: hydrateProjectTemplates takes userId
- [x] App.tsx: hydration waits for auth, passes userId
- [x] All renderer callers updated (LabelSettingsContent, LabelPicker, LabelFilterBar, QuickAddApp, DeployProjectTemplateWizard, useCreateOrMatchLabel)
- [x] MCP server callers updated
- [x] Notifications callers use global userId ('')
- [x] All tests updated and passing (357/357)

## Phase 2: Build & Packaging — TODO
- [ ] Embed Supabase credentials at build time (electron.vite.config.ts define block)
- [ ] Remove dotenv from index.ts and dependencies
- [ ] Fix hardcoded OAuth redirect URL in authStore.ts:210
- [ ] Remove vestigial better-sqlite3 references
- [ ] Install electron-builder + add build scripts
- [ ] Create macOS entitlements file
