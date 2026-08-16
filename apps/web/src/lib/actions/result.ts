/**
 * Server actions never throw across the RSC boundary (the error code would be
 * lost); they return this union instead.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      code: string
      message: string
      fieldErrors?: Record<string, string>
    }

export const actionOk = <T>(data: T): ActionResult<T> => ({ ok: true, data })

export const actionError = <T>(
  code: string,
  message: string,
  fieldErrors?: Record<string, string>,
): ActionResult<T> =>
  fieldErrors
    ? { ok: false, code, message, fieldErrors }
    : { ok: false, code, message }
