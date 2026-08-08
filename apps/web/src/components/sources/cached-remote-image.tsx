"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadCachedSourceImage,
  sourceImageCacheKey,
} from "@/lib/source-image-cache";
import { cn } from "@/lib/utils";

type CachedRemoteImageProps = {
  sourceId: string;
  url: string;
  alt?: string;
  className?: string;
  onError?: () => void;
};

export function CachedRemoteImage({
  sourceId,
  url,
  alt = "",
  className,
  onError,
}: CachedRemoteImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    const cacheKey = sourceImageCacheKey(sourceId, url);

    void (async () => {
      const blobUrl = await loadCachedSourceImage(cacheKey, url);
      if (cancelled) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        return;
      }
      if (!blobUrl) {
        // Cache fetch already failed — do not retry via <img src={url}> (doubles 404 noise).
        onErrorRef.current?.();
        return;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
      blobUrlRef.current = blobUrl;
      setSrc(blobUrl);
    })();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [sourceId, url]);

  if (!src) {
    return (
      <div
        className={cn("animate-pulse bg-surface-raised", className)}
        aria-hidden
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      referrerPolicy="no-referrer"
      onError={() => onErrorRef.current?.()}
    />
  );
}
