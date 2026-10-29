# Interface and motion conventions

These rules implement the design choices submitted on 29 October 2026. Sidebar layout, typography and selected markers retain their previous design. Colors may receive the selected contrast corrections.

## Surfaces

Use `MotionPresence` at a conditional DOM boundary, or `usePresence` when a component owns the boundary. Pass lazy children when a closing surface depends on nullable data; the last rendered content is retained until exit. `useDismissibleSurface` delays a parent removal callback for components mounted conditionally by their parent. Closing surfaces are inert and hidden from accessibility APIs; a reopened surface cancels its exit timer.

| Surface | Enter | Exit |
| --- | ---: | ---: |
| Menu, submenu, picker | 160 ms | 100 ms |
| Dialog | 220 ms | 140 ms |
| Panel | 240 ms | 160 ms |
| Toast | 180 ms | 120 ms |
| Tooltip | 125 ms | 90 ms |

The shared curve is `cubic-bezier(0.23, 1, 0.32, 1)`. Menus originate at their trigger, dialogs stay centered, and panels move from their attached edge. Menu items fade with the surface; do not stagger them. Keyboard actions, command-palette interaction and input suggestions remain immediate. Honor reduced motion, including disabling pointer press scaling.

Use `useFocusRestore` with the surface's active/present state and container ref. Nested Escape closes the topmost popup and restores its trigger. Do not move focus back when the user has already focused another surface. Keep pointer tracking immediate during drag; use the shared 160 ms settlement only after a pointer drop, with an 85% readable drag ghost. Task persistence and drop validity remain independent of presentation.

## Color and typography

`src/shared/themeCatalog.ts` owns the 18 built-in definitions and reset values. Legacy untouched presets render corrected tokens without overwriting stored customizations; edited and custom configurations remain their own values. The additive migration installs Soft Lavender, Soft Sage and Soft Blush in light/dark pairs and preserves the selected theme ID.

`ColorSwatches` provides named vivid/pastel choices and custom hex entry. Theme adjustments use this same control for every editable color role. `Improve text contrast` is an explicit action: it adjusts text roles while preserving chosen fills. The sidebar and canvas have separate derived readable foregrounds, so a dark sidebar can accompany a pastel canvas.

Theme pickers separate Built-in themes from My themes. Presets use stable local IDs on every device and never upload as custom themes. Migration 31 consolidates bug-created preset copies, archives original rows and selection references, and remaps selections to the surviving preset. Existing built-in edits and named custom themes stay intact; the different colors on bug copies are not promoted into shared presets. Incoming old copies are retired with cleanup tombstones, including queued retries and full sync. Archived aliases remain resolvable after normal tombstone purging. New custom families and renames must use an available name. Counterpart actions require an unambiguous family with the same owner and built-in/custom kind; never choose another variant by name alone.

Preserve the stored hue for dots, fills and user selections. Use `useSemanticColor` or `SemanticColorText` for readable task/status/priority/filter text; derive text on solid fills with `readableColor`. Evaluate composited backgrounds, not just raw swatches. Normal text targets 4.5:1, required non-text indicators 3:1. Decorative separators do not carry essential meaning.

Task rows have a 46 px minimum height, regular 15 px titles and 11 px metadata. Main view headings use 24 px semibold sentence case, and property/section labels use normal tracking and readable 12 px text. Do not reintroduce universal color transitions or animate keyboard selection.

## Verification

The review's `implementation-fixture` imports actual source with synthetic data and a fake Electron bridge. Use it for UI verification; never test against the real user database or settings. Run typecheck, tests, production build and an independent review before delivery. Built-in contrast, theme installation and exit/reopen timing have focused tests.
