import {
  FADED_TOP,
  FADED_WALL,
  GRADIENT_PLATE_PROPS,
  PLATE_TOP,
  PLATE_WALL,
  Plate,
} from "@/components/home/iso-plate";
import { cn } from "@/lib/utils";

/**
 * Decorative "chat with your docs" hero visual.
 * Same CSS-3D plate language as the showcase stack, but a single extruded
 * board facing the user, with the chat + cited answer rendered on its face.
 */

const SOURCES = [
  {
    ref: "1",
    title: "Agents — Tool calling",
    url: "docs.mastra.ai/agents/tools",
    score: 0.94,
  },
  {
    ref: "2",
    title: "MCP server setup",
    url: "docs.mastra.ai/mcp/server",
    score: 0.88,
  },
] as const;

function CitationChip({ label }: { label: string }) {
  return (
    <span className="mx-0.5 inline-flex size-4 translate-y-[-1px] items-center justify-center rounded border border-border bg-surface-raised align-middle font-mono text-[0.5625rem] font-bold text-muted-strong">
      {label}
    </span>
  );
}

export function HeroChatShowcase({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative flex select-none items-center justify-center [perspective:1800px]",
        className,
      )}
    >
      <div className="relative h-[27rem] w-full max-w-md [transform-style:preserve-3d] [transform:rotateX(14deg)_rotateY(-13deg)_rotateZ(1.5deg)]">
        {/* drop shadow under the whole board */}
        <span
          aria-hidden
          className="absolute inset-4 rounded-[2rem] bg-black/20 blur-2xl dark:bg-black/50"
          style={{ transform: "translateZ(-90px)" }}
        />

        {/* faded backdrop plate */}
        <Plate
          z={-56}
          thickness={12}
          grow={-14}
          topClassName={FADED_TOP}
          wallClassName={FADED_WALL}
          floatDelay="1.1s"
        />

        {/* gradient accent plate peeking out underneath */}
        <Plate z={-26} thickness={10} grow={8} floatDelay="0.6s" {...GRADIENT_PLATE_PROPS} />

        {/* main board — chat face */}
        <Plate
          z={16}
          thickness={18}
          topClassName={cn(PLATE_TOP, "overflow-hidden shadow-xl")}
          wallClassName={PLATE_WALL}
          floatDelay="0s"
        >
          <ChatFace />
        </Plate>

        {/* floating MCP badge above the board */}
        <div
          className="absolute -bottom-2 left-1/2 [transform-style:preserve-3d]"
          style={{ transform: "translateZ(72px)" }}
        >
          <div className="showcase-plate-float" style={{ animationDelay: "0.3s" }}>
            <span className="-translate-x-1/2 inline-block rounded-md border border-border bg-card-solid px-2.5 py-1 font-mono text-[0.5625rem] font-bold tracking-[0.12em] whitespace-nowrap text-foreground uppercase shadow-card">
              [ MCP · ASK_SOURCE ]
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatFace() {
  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-surface-raised/70 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded border border-border bg-card-solid font-mono text-[0.4375rem] font-bold tracking-[0.08em] text-foreground">
            IDX
          </span>
          <span className="font-mono text-[0.5625rem] font-semibold tracking-[0.1em] text-muted-strong uppercase">
            chat · mastra docs
          </span>
        </div>
        <span className="flex gap-1">
          <span className="size-1.5 rounded-full bg-amber-600/70" />
          <span className="size-1.5 rounded-full bg-slate-500/70" />
          <span className="size-1.5 rounded-full bg-stone-400/70" />
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3.5">
        {/* user question */}
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-lg rounded-br-sm border border-border bg-surface-raised px-3 py-2 text-xs leading-5 text-foreground shadow-card">
            How do agents call tools over MCP?
          </p>
        </div>

        {/* assistant answer with citations */}
        <div className="flex justify-start">
          <div className="max-w-[94%] rounded-lg rounded-bl-sm border border-border bg-card-raised px-3 py-2.5 text-xs leading-5 text-muted-strong shadow-card">
            <p>
              Register tools on the agent, then expose them through an{" "}
              <span className="font-medium text-foreground">MCPServer</span> so
              any client can call them
              <CitationChip label="1" />. Calls run through your existing
              runtime
              <CitationChip label="2" />.
            </p>
            <p className="mt-1.5 border-l-2 border-amber-600/50 pl-2 font-mono text-[0.625rem] leading-4 text-muted">
              From your docs · 2 pages linked
            </p>
          </div>
        </div>

        {/* retrieved sources */}
        <div className="mt-auto rounded-lg border border-border/80 bg-surface-alt/60 p-2.5">
          <p className="mb-1.5 font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-muted uppercase">
            Pages used
          </p>
          <ul className="flex flex-col gap-1">
            {SOURCES.map((source) => (
              <li
                key={source.ref}
                className="flex items-center gap-2 rounded-md border border-border bg-card-solid px-2 py-1.5 shadow-card"
              >
                <span className="flex size-4 shrink-0 items-center justify-center rounded border border-border bg-surface-raised font-mono text-[0.5rem] font-bold text-muted-strong">
                  {source.ref}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.6875rem] font-medium leading-4 text-foreground">
                    {source.title}
                  </p>
                  <p className="truncate font-mono text-[0.5625rem] leading-3.5 text-muted">
                    {source.url}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="h-1 w-8 overflow-hidden rounded-full bg-surface-raised">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-amber-600/80 to-slate-500"
                      style={{ width: `${source.score * 100}%` }}
                    />
                  </span>
                  <span className="font-mono text-[0.5625rem] font-semibold text-muted-strong">
                    {source.score.toFixed(2)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
