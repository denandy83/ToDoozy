/** Only user edits may write descriptions; hydration/blur must never normalize them. */
export function createDescriptionAutosave(save: (value: string | null) => void): {
  edit(value: string | null): void
  flush(): void
  cancel(): void
} {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: { value: string | null } | undefined
  const cancel = (): void => {
    clearTimeout(timer)
    timer = undefined
    pending = undefined
  }
  const flush = (): void => {
    const edit = pending
    cancel()
    if (edit) save(edit.value)
  }
  return {
    edit(value) {
      clearTimeout(timer)
      pending = { value }
      timer = setTimeout(flush, 1000)
    },
    flush,
    cancel
  }
}
