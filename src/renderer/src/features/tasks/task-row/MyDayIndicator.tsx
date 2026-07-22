import { Sun } from 'lucide-react'

export function MyDayIndicator({ visible, onToggle }: { visible: boolean; onToggle?: () => void }): React.JSX.Element {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle?.() }}
      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
        visible ? 'bg-accent/15 hover:bg-accent/25' : 'opacity-0 group-hover:opacity-100 hover:bg-accent/10'
      }`}
      title={visible ? 'Remove from My Day' : 'Add to My Day'}
      aria-label={visible ? 'Remove from My Day' : 'Add to My Day'}
    >
      <Sun size={10} className={visible ? 'text-accent' : 'text-accent/60'} />
    </button>
  )
}
