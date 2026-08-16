import type { ActionResult } from './result'

/**
 * Server actions return an `ActionResult` union instead of throwing (the error
 * code would not survive the RSC boundary). TanStack, on the other hand, wants
 * a rejected promise for `isError`/`onError` to work — so every action call
 * inside a query/mutation goes through this: unwrap on success, throw a real
 * Error carrying the code and field errors on failure.
 */
export class ActionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message)
    this.name = 'ActionError'
  }
}

export const unwrapAction = <T>(result: ActionResult<T>): T => {
  if (result.ok) return result.data
  throw new ActionError(result.message, result.code, result.fieldErrors)
}
