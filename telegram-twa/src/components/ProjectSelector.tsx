import type { SharedProject } from '../types'

interface ProjectSelectorProps {
  projects: SharedProject[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function ProjectSelector({ projects, selectedId, onSelect }: ProjectSelectorProps) {
  if (projects.length === 0) {
    return (
      <div className="px-4 py-8 text-center" style={{ color: 'var(--tg-theme-hint-color)' }}>
        <p className="text-sm">No shared projects found.</p>
        <p className="text-xs mt-2">
          Share a project in the ToDoozy desktop app to see it here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex gap-2 px-4 py-3 overflow-x-auto">
      {projects.map(project => {
        const isSelected = project.id === selectedId
        return (
          <button
            key={project.id}
            onClick={() => onSelect(project.id)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider whitespace-nowrap shrink-0"
            style={{
              backgroundColor: isSelected ? project.color + '20' : 'var(--tg-theme-secondary-bg-color)',
              color: isSelected ? project.color : 'var(--tg-theme-text-color)',
              border: isSelected ? `1.5px solid ${project.color}` : '1.5px solid transparent'
            }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: project.color }}
            />
            {project.name}
          </button>
        )
      })}
    </div>
  )
}
