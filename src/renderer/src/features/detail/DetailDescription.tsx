import { TiptapEditor } from './editor/TiptapEditor'

interface DetailDescriptionProps {
  description: string | null
  taskId: string
  onDescriptionChange: (description: string | null) => void
}

export function DetailDescription({
  description,
  taskId,
  onDescriptionChange
}: DetailDescriptionProps): React.JSX.Element {
  return <TiptapEditor content={description} taskId={taskId} onChange={onDescriptionChange} />
}
