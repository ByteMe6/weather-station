/* Test stub for `next/navigation` — tests mutate routerState/navState as needed. */
export const routerState = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  refresh: jest.fn(),
  prefetch: jest.fn(),
}
export const navState = { pathname: '/', search: new URLSearchParams() }

export const useRouter = () => routerState
export const usePathname = () => navState.pathname
export const useSearchParams = () => navState.search
export const redirect = (url: string): never => {
  throw new Error(`NEXT_REDIRECT:${url}`)
}
