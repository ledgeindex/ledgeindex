import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ForwardedRef,
  type MouseEvent,
  type ReactNode
} from 'react'
import { Link as RouterLink } from 'react-router-dom'

type NextLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
  children?: ReactNode
  replace?: boolean
  prefetch?: boolean
  scroll?: boolean
}

const Link = forwardRef(function Link(
  { href, children, replace, onClick, ...rest }: NextLinkProps,
  ref: ForwardedRef<HTMLAnchorElement>
) {
  return (
    <RouterLink
      ref={ref}
      to={href}
      replace={replace}
      onClick={onClick as ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined}
      {...rest}
    >
      {children}
    </RouterLink>
  )
})

export default Link
