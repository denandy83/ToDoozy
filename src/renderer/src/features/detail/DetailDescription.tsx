import { TiptapEditor } from './editor/TiptapEditor'

interface DetailDescriptionProps {
  description: string | null
  onDescriptionChange: (description: string | null) => void
}

export function DetailDescription({
  description,
  onDescriptionChange
}: DetailDescriptionProps): React.JSX.Element {
  return <TiptapEditor content={description} onChange={onDescriptionChange} />
}
