interface SubtaskBadgeProps {
  done: number
  total: number
}

export function SubtaskBadge({ done, total }: SubtaskBadgeProps): React.JSX.Element {
  const pct = total > 0 ? (done / total) * 100 : 0
  return (
    <div className="flex flex-shrink-0 items-center gap-1.5">
      <div className="h-1 w-8 overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full rounded-full bg-accent transition-all motion-safe:duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
        {done}/{total}
      </span>
    </div>
  )
}
