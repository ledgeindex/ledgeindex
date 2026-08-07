import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* Shared isometric plate primitive (LlamaIndex-style extruded layers). */

export const PLATE_TOP = "rounded-lg border border-border bg-card-solid";
export const PLATE_WALL = "rounded-sm border border-border bg-surface-raised";
export const FADED_TOP = "rounded-lg border border-border/70 bg-card-solid/70";
export const FADED_WALL = "rounded-sm border border-border/60 bg-surface-raised/60";

export const GRADIENT_PLATE_PROPS = {
  topClassName:
    "rounded-lg bg-gradient-to-br from-stone-200 via-amber-100 to-slate-300 dark:from-stone-300 dark:via-amber-200/80 dark:to-slate-400",
  wallSouthClassName:
    "bg-gradient-to-r from-amber-700/80 via-slate-500 to-stone-400",
  wallEastClassName: "bg-gradient-to-b from-slate-500 to-stone-600",
  wallNorthClassName: "bg-stone-300 dark:bg-stone-400",
  wallWestClassName: "bg-gradient-to-b from-amber-600/80 to-slate-500",
} as const;

export type PlateProps = {
  /** Elevation of the plate's top face (px). Walls hang down `thickness`. */
  z: number;
  thickness: number;
  /** Extra size in px (negative inset). 0 = same footprint. */
  grow?: number;
  topClassName?: string;
  wallClassName?: string;
  /** Override walls individually (e.g. gradient rim). */
  wallSouthClassName?: string;
  wallEastClassName?: string;
  wallNorthClassName?: string;
  wallWestClassName?: string;
  floatDelay?: string;
  /** Fade the plate out (faces only — group opacity would flatten 3D). */
  hidden?: boolean;
  children?: ReactNode;
};

/**
 * Extruded plate: top face at `z`, four side walls hanging down `thickness`.
 * Position changes (`z`, `grow`) transition smoothly, so per-step stack
 * choreography works by just re-rendering with new values.
 * No opacity/filter on 3D groups — both would flatten preserve-3d, which is
 * why `hidden` fades each face individually.
 */
export function Plate({
  z,
  thickness,
  grow = 0,
  topClassName,
  wallClassName,
  wallSouthClassName,
  wallEastClassName,
  wallNorthClassName,
  wallWestClassName,
  floatDelay,
  hidden = false,
  children,
}: PlateProps) {
  const faceVisibility = cn(
    "transition-opacity duration-500",
    hidden ? "opacity-0" : "opacity-100",
  );
  return (
    <div
      className="absolute transition-all duration-700 ease-out [transform-style:preserve-3d]"
      style={{ inset: -grow, transform: `translateZ(${z}px)` }}
    >
      <div
        className="showcase-plate-float absolute inset-0 [transform-style:preserve-3d]"
        style={{ animationDelay: floatDelay }}
      >
        {/* top face */}
        <div className={cn("absolute inset-0", faceVisibility, topClassName)}>
          {children}
        </div>

        {/* south wall (front-left in iso view) */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-x-0 bottom-0 origin-bottom",
            faceVisibility,
            wallSouthClassName ?? wallClassName,
          )}
          style={{ height: thickness, transform: "rotateX(90deg)" }}
        />
        {/* east wall (front-right in iso view) */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 right-0 origin-right",
            faceVisibility,
            wallEastClassName ?? wallClassName,
          )}
          style={{ width: thickness, transform: "rotateY(-90deg)" }}
        />
        {/* north wall */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-x-0 top-0 origin-top",
            faceVisibility,
            wallNorthClassName ?? wallClassName,
          )}
          style={{ height: thickness, transform: "rotateX(-90deg)" }}
        />
        {/* west wall */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 origin-left",
            faceVisibility,
            wallWestClassName ?? wallClassName,
          )}
          style={{ width: thickness, transform: "rotateY(90deg)" }}
        />
      </div>
    </div>
  );
}