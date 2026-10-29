# Interface and motion conventions

These rules implement the design choices submitted on 29 October 2026. Sidebar layout, typography and selected markers retain their previous design. Colors may receive the selected contrast corrections.

## Surfaces

Use `MotionPresence` at a conditional DOM boundary, or `usePresence` when a component owns the boundary. Pass lazy children when a closing surface depends on nullable data; the last rendered content is retained until exit. `useDismissibleSurface` delays a parent removal callback for components mounted conditionally by their parent. Closing surfaces are inert and hidden from accessibility APIs; a reopened surface cancels its exit timer.

[`motion.ts`](../src/renderer/src/shared/motion/motion.ts) owns the surface timings (`MOTION`), shared curve (`EASE_OUT`) and reorder duration (`REORDER_DURATION`). The corresponding surface transitions live in [`main.css`](../src/renderer/src/assets/main.css); use those shared classes instead of per-component animation utilities.

Menus originate at their trigger, dialogs stay centered, and panels move from their attached edge. Menu items fade with the surface; do not stagger them. Keyboard actions, command-palette interaction and input suggestions remain immediate. Honor reduced motion, including disabling pointer press scaling.

Use `useFocusRestore` with the surface's active/present state and container ref. Nested Escape closes the topmost popup and restores its trigger. Do not move focus back when the user has already focused another surface. Keep pointer tracking immediate during drag; use the shared reorder duration for settlement only after a valid pointer drop, with a readable drag ghost. Task persistence and drop validity remain independent of presentation.

## Color and typography

[`themeCatalog.ts`](../src/shared/themeCatalog.ts) owns built-in definitions, stable identities and reset values. [`ThemeConfig`](../src/shared/types.ts) defines editable roles; [`useThemeApplicator.ts`](../src/renderer/src/shared/hooks/useThemeApplicator.ts) maps them to CSS properties and derives canvas/sidebar foregrounds. Legacy untouched presets render corrected tokens without overwriting stored customizations; edited and custom configurations retain their own values. The additive preset migration preserves the selection; the subsequent duplicate repair can remap its ID while preserving the chosen preset.

`ColorSwatches` uses the shared [`colorPalette.ts`](../src/renderer/src/shared/utils/colorPalette.ts) choices; `ColorPicker` adds editable hex values. See [Themes](../HELP.md#themes) for the user workflow. The sidebar and canvas have separate derived readable foregrounds, so a dark sidebar can accompany a pastel canvas.

Presets never upload as custom themes. [`repairBuiltinThemes`](../src/main/database/themeRepair.ts), registered in the migration list, consolidates bug-created preset copies, archives original rows and selection references, and remaps selections to the surviving preset. Existing built-in edits and named custom themes stay intact; the different colors on bug copies are not promoted into shared presets. Incoming old copies are retired with cleanup tombstones, including queued retries and full sync. Archived aliases remain resolvable after normal tombstone purging. Counterpart actions require an unambiguous family with the same owner and built-in/custom kind; never choose another variant by name alone.

Accepted persisted theme state owns the renderer selection. Shared sync merges refresh the theme map and selection with account/database and concurrent-local-write guards; ordinary settings reconciliation retries that refresh even when the persisted selection already matches. UI handlers must not reassign a captured theme ID after awaiting saves. See [`settingsStore.ts`](../src/renderer/src/shared/stores/settingsStore.ts), [`syncTables.ts`](../src/renderer/src/services/syncTables.ts) and the isolated regressions in [`themeSelectionOrdering.test.ts`](../src/renderer/src/services/themeSelectionOrdering.test.ts).

Preserve the stored hue for dots, fills and user selections. Use `useSemanticColor` or `SemanticColorText` for readable task/status/priority/filter text; derive text on solid fills with `readableColor`. Evaluate composited backgrounds, not just raw swatches. Normal text targets 4.5:1, required non-text indicators 3:1. Decorative separators do not carry essential meaning.

Task rows have a 46 px minimum height, regular 15 px titles and 11 px metadata. Main view headings use 24 px semibold sentence case, and property/section labels use normal tracking and readable 12 px text. Do not reintroduce universal color transitions or animate keyboard selection.

Keyboard focus uses a visible outline with a separately derived readable focus color for the canvas and sidebar; do not reduce it to a faint selection shadow. Row actions become visible on focus within the row as well as on hover.

## Verification

Browser fixtures under [`scripts/`](../scripts/) import actual components and use synthetic data. Run them through `node scripts/verify-popup-motion.mjs [scripts/<fixture>.browser.tsx]`; omitting the argument runs the popup-motion fixture. Never test against the real user database or settings. Run typecheck, tests, production build and an independent review before delivery. Built-in contrast, theme installation and exit/reopen timing have focused tests.
