/** Shared app state — avoids circular imports between main modules */
export let isQuitting = false

export function setIsQuitting(value: boolean): void {
  isQuitting = value
}
