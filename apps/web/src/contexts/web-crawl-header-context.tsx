"use client";

import { useSyncExternalStore, type ReactNode } from "react";

type Listener = () => void;

let controls: ReactNode = null;
const listeners = new Set<Listener>();

function subscribe(onStoreChange: Listener) {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot() {
  return controls;
}

function getServerSnapshot() {
  return null;
}

/** Lift crawl settings into the desktop app header without a DOM portal. */
export function setWebCrawlHeaderControls(next: ReactNode) {
  controls = next;
  listeners.forEach((listener) => listener());
}

export function useWebCrawlHeaderControls() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
