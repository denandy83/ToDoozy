import { TiptapEditor } from './editor/TiptapEditor'
import { formatDate } from '../../shared/utils/dateFormat'

interface DetailDescriptionProps {
  description: string | null
  taskId: string
  updatedAt?: string
  onDescriptionChange: (description: string | null) => void
  readOnly?: boolean
}

export function DetailDescription({
  description,
  taskId,
  updatedAt,
  onDescriptionChange,
  readOnly
}: DetailDescriptionProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <TiptapEditor content={description} taskId={taskId} onChange={onDescriptionChange} readOnly={readOnly} />
      {updatedAt && (
        <span className="text-[9px] font-bold uppercase tracking-wider text-muted/40">
          Last updated {formatDate(updatedAt, undefined, { omitCurrentYear: true })}{updatedAt.includes('T') ? ` ${updatedAt.split('T')[1].slice(0, 5)}` : ''}
        </span>
      )}
    </div>
  )
}
