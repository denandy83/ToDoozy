import { TiptapEditor } from './editor/TiptapEditor'
import { formatDate, formatTime } from '../../shared/utils/dateFormat'

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
      <TiptapEditor key={taskId} content={description} taskId={taskId} onChange={onDescriptionChange} readOnly={readOnly} />
      {updatedAt && (
        <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
          Last updated {formatDate(updatedAt, undefined, { omitCurrentYear: true })}{updatedAt.includes('T') ? ` ${formatTime(updatedAt)}` : ''}
        </span>
      )}
    </div>
  )
}
