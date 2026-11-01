interface Result { error: { message: string } | null }

/** A backend failure is never an authoritative empty result or successful write. */
export async function requireSuccess<T extends Result>(query: PromiseLike<T>): Promise<T> {
  const result = await query
  if (result.error) throw new Error(result.error.message)
  return result
}

interface PageQuery<T> extends PromiseLike<{ data: T[] | null; error: { message: string } | null }> {
  order(column: string): PageQuery<T>
  limit(count: number): PageQuery<T>
  or(filter: string): PageQuery<T>
}

/** Stable keyset pagination. Continue to an empty page even with a lower API cap. */
export async function readAll<T extends Record<string, unknown>>(
  query: () => PageQuery<T>, keys: string[] = ['id'],
  sort: Array<{ column: string; ascending?: boolean }> = []
): Promise<{ data: T[]; error: null }> {
  const rows: T[] = []
  let cursor: T | undefined
  for (;;) {
    let pageQuery = query()
    for (const key of keys) pageQuery = pageQuery.order(key)
    if (cursor) {
      pageQuery = pageQuery.or(keys.map((key, index) => {
        const before = keys.slice(0, index).map((k) => `${k}.eq.${JSON.stringify(cursor![k])}`)
        const after = `${key}.gt.${JSON.stringify(cursor![key])}`
        return before.length ? `and(${[...before, after].join(',')})` : after
      }).join(','))
    }
    const { data } = await requireSuccess(pageQuery.limit(500))
    const page = data ?? []
    if (!page.length) {
      if (sort.length) rows.sort((a,b) => {
        for (const { column, ascending = true } of sort) {
          const x=a[column], y=b[column]
          if (x===y) continue
          const comparison=x==null ? 1 : y==null ? -1 : x<y ? -1 : 1
          return ascending ? comparison : -comparison
        }
        return 0
      })
      return { data: rows, error: null }
    }
    const next = page[page.length - 1]
    if (cursor && keys.every((key) => next[key] === cursor![key])) throw new Error('Pagination cursor did not advance')
    rows.push(...page)
    cursor = next
  }
}
