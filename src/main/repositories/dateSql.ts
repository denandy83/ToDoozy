function hasDateZoneSql(value: string): string {
  return `(substr(${value}, -1) IN ('Z', 'z') OR substr(${value}, 12) GLOB '*[+-]*')`
}

export function dueDaySql(value: string): string {
  return `(CASE WHEN ${hasDateZoneSql(value)} THEN date(${value}, 'localtime') ELSE date(${value}) END)`
}
