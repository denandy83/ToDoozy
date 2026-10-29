export function isTabHandledLocally(event: KeyboardEvent, boundary?: Element): boolean {
  if (event.defaultPrevented) return true
  if (!(event.target instanceof Element)) return false
  const scope = event.target.closest('.ui-surface, .ui-color-swatches, .react-datepicker-popper, dialog, [role="dialog"], [role="alertdialog"], [role="menu"]')
  return scope !== null && scope !== boundary
}
