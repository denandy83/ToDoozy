interface PageQuery<T> extends PromiseLike<{ data: T[] | null; error: { message: string } | null }> {
  order(column: string): PageQuery<T>
  limit(count: number): PageQuery<T>
  or(filter: string): PageQuery<T>
}

export async function readAll<T extends Record<string, unknown>>(
  query: () => PageQuery<T>, keys: string[] = ['id']
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows = new Map<string, T>()
  let cursor: T | undefined
  for (;;) {
    let pageQuery = query()
    for (const key of keys) pageQuery = pageQuery.order(key)
    if (cursor) {
      pageQuery = pageQuery.or(keys.map((key, index) => {
        const prefix = keys.slice(0, index).map((previous) => `${previous}.eq.${JSON.stringify(cursor![previous])}`)
        const after = `${key}.gt.${JSON.stringify(cursor![key])}`
        return prefix.length ? `and(${[...prefix, after].join(',')})` : after
      }).join(','))
    }
    const { data, error } = await pageQuery.limit(500)
    if (error) throw new Error(error.message)
    const page = data ?? []
    for (const row of page) rows.set(JSON.stringify(keys.filter((key) => key !== 'updated_at').map((key) => row[key])), row)
    if (page.length < 500) return { data: [...rows.values()], error: null }
    cursor = page[page.length - 1]
  }
}

export async function readAllIn<T extends Record<string, unknown>>(
  ids: string[], query: (ids: string[]) => PageQuery<T>, keys: string[] = ['id']
): Promise<{ data: T[]; error: { message: string } | null }> {
  const data: T[] = []
  for (let index = 0; index < ids.length; index += 200) {
    data.push(...(await readAll(() => query(ids.slice(index, index + 200)), keys)).data)
  }
  return { data, error: null }
}
