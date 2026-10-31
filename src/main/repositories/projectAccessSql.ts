export function projectAccessSql(task: string): string {
  return `($projectUser IS NULL OR EXISTS (
    SELECT 1 FROM projects accessible_project
    WHERE accessible_project.id = ${task}.project_id AND accessible_project.deleted_at IS NULL
      AND (accessible_project.owner_id = $projectUser OR EXISTS (
        SELECT 1 FROM project_members accessible_member
        WHERE accessible_member.project_id = accessible_project.id AND accessible_member.user_id = $projectUser
      ))
  ))`
}
