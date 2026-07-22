/** Thrown by every service function instead of a generic Error (CLAUDE.md). */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}
