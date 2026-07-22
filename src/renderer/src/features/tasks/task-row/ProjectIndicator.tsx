import type { Project } from '../../../../../shared/types'

function getProjectInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

export function ProjectIndicator({ project }: { project: Project }): React.JSX.Element {
  return (
    <div
      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: project.color }}
      title={project.name}
    >
      <span className="text-[7px] font-bold leading-none text-white">
        {getProjectInitials(project.name)}
      </span>
    </div>
  )
}
