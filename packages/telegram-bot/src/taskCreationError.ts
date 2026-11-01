/** Safe, explicit partial-success result; generic backend errors stay private. */
export class PartialTaskCreationError extends Error {
  constructor(readonly taskId: string) {
    super(`Task created (${taskId}), but the requested labels were not saved. Open this task to retry labels; do not recreate it.`)
    this.name = 'PartialTaskCreationError'
  }
}
