"use client";

type CachedRemoteImageProps = {
  sourceId: string;
  url: string;
  alt?: string;
  className?: string;
  onError?: () => void;
};

export function CachedRemoteImage(props: CachedRemoteImageProps) {
  const { url, alt = "", className, onError } = props;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className={className}
      referrerPolicy="no-referrer"
      onError={onError}
    />
  );
}
