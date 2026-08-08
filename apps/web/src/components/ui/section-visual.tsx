import { cn } from "@/lib/utils";

type SectionVisualProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
};

export function SectionVisual({
  src,
  alt,
  width,
  height,
  className,
  priority = false,
}: SectionVisualProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      decoding={priority ? "sync" : "async"}
      fetchPriority={priority ? "high" : undefined}
      className={cn("h-auto w-full object-contain drop-shadow-sm", className)}
      suppressHydrationWarning
    />
  );
}
