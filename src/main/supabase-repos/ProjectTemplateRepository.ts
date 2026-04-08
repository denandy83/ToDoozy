import type { ProjectTemplate } from '../../shared/types'
import type { AsyncProjectTemplateRepository } from './index'

export class SupabaseProjectTemplateRepository implements AsyncProjectTemplateRepository {
  async findById(_id: string): Promise<ProjectTemplate | undefined> {
    throw new Error('Project templates are not available in Supabase mode (local-only feature)')
  }

  async findByOwnerId(_ownerId: string): Promise<ProjectTemplate[]> {
    // Return empty array instead of throwing — list_templates needs this to work
    return []
  }
}
