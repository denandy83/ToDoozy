# UI Learnings

Visual patterns and fixes discovered during UI work. Read this at the start of every UI fix or audit.

---

## react-datepicker — `--keyboard-selected` bleeds into every navigated month

**What it looked like:** The calendar always showed a filled day — today when no date was set, or the same day-of-month as the selected date in every month you navigated to (e.g. April 18 set → May 18, June 18 all appeared "selected").

**Root cause:** Styling `.react-datepicker__day--keyboard-selected` identically to `.react-datepicker__day--selected`. react-datepicker uses `--keyboard-selected` for the keyboard-focus day, which (a) defaults to today when nothing is selected and (b) mirrors the selected day-of-month across navigated months.

**Fix:** Only style `.react-datepicker__day--selected` with the accent fill. Neutralize `.react-datepicker__day--keyboard-selected:not(--selected)` to transparent/foreground. Give `.react-datepicker__day--today:not(--selected)` a `box-shadow: inset 0 0 0 1px var(--color-accent)` border instead of a fill.

**Measurement notes:** `box-shadow: inset` avoids the layout shift that a real `border` would cause since react-datepicker days have fixed sizing. Always scope the today/keyboard-selected rules with `:not(.react-datepicker__day--selected)` so the real selection keeps precedence.

**Check first:** If you see react-datepicker highlighting unexpected days, grep for `--keyboard-selected` in CSS — that's almost always the culprit.
