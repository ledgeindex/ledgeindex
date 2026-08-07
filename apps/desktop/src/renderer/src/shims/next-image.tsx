import type { ImgHTMLAttributes, ReactNode } from 'react'

type NextImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src: string
  alt: string
  width?: number | string
  height?: number | string
  fill?: boolean
  priority?: boolean
  quality?: number
  placeholder?: string
  blurDataURL?: string
  unoptimized?: boolean
  loader?: unknown
}

export default function Image({
  src,
  alt,
  width,
  height,
  fill,
  style,
  className,
  ...rest
}: NextImageProps): ReactNode {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- desktop shim
    <img
      src={src}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      className={className}
      style={
        fill
          ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...style }
          : style
      }
      {...rest}
    />
  )
}
