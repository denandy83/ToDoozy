import { observeDatabaseScope, useAuthStore } from '../stores/authStore'

export function useDatabaseScope(): string | null {
  observeDatabaseScope()
  return useAuthStore(state => state.databaseScope)
}
