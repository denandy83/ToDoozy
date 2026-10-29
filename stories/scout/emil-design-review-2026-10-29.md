# ToDoozy design review — 29 October 2026

Source snapshot: `1ca14e5`. Review revision: 2.

The user requested an Emil Kowalski design review, before/after choices, and implementation after submission. Scope includes standardized fade in/out, popup lifecycle, movement and drag/drop, theme contrast, and discoverable pastels.

| Before | After | Why |
| --- | --- | --- |
| The project heading is 30 px, light, uppercase and widely spaced. Section and toolbar labels also rely on small, bold capitals. | Use a 24 px semibold project heading in sentence case. Give section labels normal spacing and readable 12 px type; keep the task titles as the main reading surface. | A task manager needs fast scanning. Reserve emphasis for the project and current work, then let the controls recede. |
| Task titles use 15 px light text. Priority and date metadata use 9–10 px bold uppercase text; rows have no separators. | Keep 15 px titles with a regular reading weight. Use 11 px, medium-weight metadata and very faint separators. Give each row a 46 px minimum height. | Improve legibility and keep the title, due date and priority easy to distinguish without adding large cards. |
| Sidebar labels are light. The selected project uses a tinted fill and thin border; footer actions are small spaced capitals. | Use regular-weight navigation labels, a quiet inset accent marker for the selected item, more separation between groups, and sentence-case footer actions. | Make location clearer at a glance while keeping the existing sidebar structure and project colors. |
| Property labels are 10 px, uppercase and tracked at 0.3 em. The form is compact and uses light text throughout. | Use 12 px medium-weight property labels in sentence case, clearer space between fields, regular input text, and a 1.65 line height in the description editor. | Make longer editing sessions easier to read and make each property group distinct. |
| Several row actions are small icon buttons; some are transparent until hover. The global focus treatment is a 1 px shadow, and buttons lack a consistent press response. | Use at least 26 px desktop hit areas, a clear 2 px keyboard focus outline, visible actions on focus within a row, and a subtle 0.97 scale on pointer press. | A click should feel acknowledged and keyboard focus should be obvious. These are interaction affordances, not decorative motion. |
| main.css applies 300 ms background, text and border transitions to every element. TaskRow also uses transition-all, including selection and drag feedback. | Remove the universal transition. Keep task selection and command-palette navigation immediate. Use short, explicitly scoped hover and press transitions only where helpful. | Repeated keyboard actions should stay connected to the key press; visual lag compounds across hundreds of interactions. |
| Menu, submenu, dialog and panel behavior is defined separately. Several entry utility names have no matching build rules; conditional rendering removes surfaces immediately on close. | Use a shared set of motion tokens and a retained open/close lifecycle. Menus fade and scale in 160 ms / out 100 ms; dialogs use 220 / 140 ms; panels use 240 / 160 ms. Items fade as one surface, without stagger. | Repeated components should behave the same. Fades, origins, timing and interrupted exits need a shared rule, not one-off values. |
| ToastContainer uses light message text, small uppercase action text and enter-animation utility names that are absent from the fixture CSS build. | Use 13 px regular-to-medium toast text and a readable Undo action. Add a restrained 180 ms entrance from 8 px below; keep a consistent direction for exit. | Occasional feedback needs to be noticed and understood, with an action that is easy to find. |
| DragOverlay disables its drop animation. The task ghost is set to 30% opacity. Rows, kanban cards, project lists and saved-view sorting use separate drag treatments. | Keep pointer tracking immediate. Use an 85% readable ghost, one insertion treatment and a short 160 ms settling motion after a valid pointer drop. Reordering uses a shared 160 ms movement rule. | Movement should explain where the item is going, while keeping dragging direct and the final position easy to follow. |
| The twelve built-in themes each have a muted token below 4.5:1 on at least one canvas/sidebar/derived-surface pairing. Some accent/button text pairs also miss the target. Preset theme definitions are duplicated. | Keep each theme’s character, but repair text roles for readable contrast on the surfaces where they appear. Choose a readable foreground for accent and semantic fills, and define theme defaults once. | Soft-looking colors and readable content need separate roles. A pastel fill should not force pastel text, and quiet labels still need to be legible. |
| Project and label pickers offer eight vivid presets. Custom hex entry exists, but there is no dedicated pastel set or matching soft theme pair. | Add eight shared pastel choices: lavender, sage, peach, powder blue, blush, butter, aqua and stone. Add Soft Lavender, Soft Sage and Soft Blush in paired light/dark themes. Keep readable text tones separate from fills. | Make softer color choices discoverable and consistent across projects, labels, saved views and statuses, without requiring manual hex codes. |

## Evidence and delivery

- Before views bundle actual React components with synthetic, in-memory data from a frozen source snapshot. No live app data/configuration or credentials are read.
- Popup lifecycle and palette views are explicitly labeled behavior/color studies. Other before/after views use actual components with isolated proposal styles.
- Existing reduced-motion handling, focus traps/restoration, theme customization and keyboard navigation are retained as strengths.
- The fixture CSS build has no matching animate-in/fade-in/zoom-in rules for several referenced entry utility names.
- All 12 built-in themes have a muted token below 4.5:1 on at least one main surface; some accent foreground pairs also fail. Calculations use sRGB luminance, with min ratios across canvas/sidebar/derived surface; composed opacity states are not certified.
- Proposal: eight additional pastel swatches and Soft Lavender/Sage/Blush light/dark pairs; preserve current theme selection, existing colors and custom hex entry.
- No production app code or backlog state changed in the investigation. prd.sh, agent-run.sh and the referenced verifier charter are missing from the documented paths. The review includes explicit per-submission consent for direct source edits + typecheck/tests + fresh independent review.

## Artifact locations

- Source and API: `/Users/alfred/Documents/Codex/2026-10-29/todoozy-design-review`.
- Remote review: `http://100.110.218.110/reviews/2026-10-29-todoozy-design/` (private Tailscale).
- Dashboard directory card preference is pending; no dash.html modification is included.
- Submission state and job logs remain outside the served directory. Submitting a complete selection with direct-workflow approval resumes this same Codex conversation; Before choices are frozen. No push or release is authorized.

## Sources

- [Emil’s official skill collection](https://github.com/emilkowalski/skills)
- [You Don’t Need Animations](https://emilkowal.ski/ui/you-dont-need-animations)
- [Frequency of use and keyboard actions](https://emilkowal.ski/ui/you-dont-need-animations#frequency-of-use)
- [Good vs Great Animations](https://emilkowal.ski/ui/good-vs-great-animations)
- [Emil’s design engineering skill · gestures & motion](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md)
- [W3C · contrast for normal text and UI indicators](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

## Verification

- Artifact production bundle built successfully. Eight isolated review storage/authorization tests passed.
- All 36 hosted files and assets returned 200 with matching byte sizes through the private Tailscale URL; existing Dash and Rivet health routes still return 200.
- The 390 px layout was checked visually. Popup menu dismissal and dialog opening were exercised in the labeled behavior study.
- Decision persistence was exercised on a temporary review store. Live user choices are empty; no implementation job was started by verification.
- Native automation did not confirm drag reordering in two attempts. The drag preview uses real components, but full drag/drop behavior verification remains part of implementation acceptance.

## Approved implementation — 29 October 2026

The submitted selection chose After for ten details and Before for the sidebar. Per-submission direct-workflow approval was recorded because the documented orchestration helpers are absent. The implementation preserves the sidebar layout and adds shared motion/presence, focus handling, readable task properties, contrast-safe theme roles, and shared vivid/pastel palettes. The user's clarification extends pastel choices to every theme color adjustment, including background, sidebar, accent, text, and borders. Six soft presets bring the built-in total to eighteen. Existing custom theme configurations and the selected theme ID are preserved.

Final validation: typecheck and production build passed; 92 test files / 1,653 tests passed; lint reports zero errors and fifteen hook dependency warnings. A fresh independent verifier passed the source review and exercised actual components with synthetic data, including theme pastels/contrast repair, nested Escape/focus, instant keyboard palette, list and kanban dragging, project and My Day drops, multiselect moves, and saved-view sorting. The earlier investigation's unconfirmed drags were resolved in this implementation review.

Live persistence, network sync, reduced-motion emulation, and frame-by-frame mid-drag cancellation were not exercised. Source review and focused tests cover the relevant presentation/lifecycle rules; no live user database or settings were used. No push or release was performed.

- Implementation preview: `http://100.110.218.110/reviews/2026-10-29-todoozy-design/implemented/`.
- Independent evidence: `/Users/alfred/Documents/Codex/2026-10-29/todoozy-design-review/private/independent-verification.md`.
- Shared maintenance conventions: `docs/design-system.md`.
