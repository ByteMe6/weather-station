/**
 * Full-document navigation, as opposed to `router.replace()`'s client-side
 * transition. Needed after Clerk's `setActive()`: the session cookie carries a
 * new token with the activated organisation, and only a fresh document request
 * makes the server (proxy, layouts and server actions) see it. A soft
 * transition leaves actions posting from the old route with the old token,
 * which the admin gate then correctly refuses (found in browser verification).
 *
 * Extracted so tests can assert the navigation without jsdom's unimplemented
 * location machinery.
 */
export const hardNavigate = (href: string): void => {
  window.location.assign(href)
}
