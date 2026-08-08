import { useMemo } from 'react'
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams as useRouterParams,
  useSearchParams as useReactRouterSearchParams
} from 'react-router-dom'

export function useRouter() {
  const navigate = useNavigate()
  return useMemo(
    () => ({
      push: (href: string, _options?: { scroll?: boolean }) => {
        void navigate(href)
      },
      replace: (href: string, _options?: { scroll?: boolean }) => {
        void navigate(href, { replace: true })
      },
      back: () => {
        void navigate(-1)
      },
      forward: () => {
        void navigate(1)
      },
      refresh: () => {
        window.location.reload()
      },
      prefetch: async (_href?: string) => undefined
    }),
    [navigate]
  )
}

export function usePathname(): string {
  return useLocation().pathname
}

export function useSearchParams(): URLSearchParams {
  const [params] = useReactRouterSearchParams()
  return params
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  return useRouterParams() as T
}

export function redirect(href: string): never {
  throw new Error(`redirect(${href}) is not supported in the desktop renderer`)
}

export function notFound(): never {
  throw new Error('notFound() is not supported in the desktop renderer')
}

export { Navigate }
