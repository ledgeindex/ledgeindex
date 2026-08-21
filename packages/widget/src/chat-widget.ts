import { marked, type Tokens } from "marked";
import { highlightElement } from "@speed-highlight/core";
import shjCss from "@speed-highlight/core/themes/github-light.css?inline";
import {
  askWidgetStream,
  escapeHtml,
  type WidgetCitation,
  type WidgetConfig,
} from "./api";

/** Map common markdown fences onto speed-highlight language ids. */
function mapLang(lang: string | undefined): string {
  const raw = (lang || "plain").toLowerCase().trim();
  const aliases: Record<string, string> = {
    javascript: "js",
    typescript: "ts",
    tsx: "ts",
    jsx: "js",
    python: "py",
    shell: "bash",
    sh: "bash",
    zsh: "bash",
    yml: "yaml",
    text: "plain",
    txt: "plain",
  };
  return aliases[raw] ?? raw;
}

const renderer = new marked.Renderer();
renderer.code = ({ text, lang }: Tokens.Code): string => {
  const language = mapLang(lang);
  return `<pre class="li-pre li-scroll"><code class="shj-lang-${escapeHtml(language)}">${escapeHtml(text)}</code></pre>`;
};
renderer.link = ({ href, title, text }: Tokens.Link): string => {
  const safeHref = href ? escapeHtml(href) : "";
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.setOptions({
  renderer,
  gfm: true,
  breaks: false,
});

function widgetStyles(accent: string): string {
  // Match apps/web light theme tokens (globals.css :root).
  const brand = accent?.trim() || "#6b5a3e";
  return `
${shjCss}
:host {
  all: initial;
  font-family: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  color-scheme: light;
}
* { box-sizing: border-box; }
.li-root {
  --li-bg: #f6f2ea;
  --li-fg: #1c1917;
  --li-muted: #78716c;
  --li-muted-strong: #44403c;
  --li-border: rgb(214 204 190 / 0.9);
  --li-card: #fffcf7;
  --li-raised: #f0ebe3;
  --li-accent: ${brand};
  --li-accent-soft: color-mix(in srgb, ${brand} 12%, transparent);
  --li-shadow: 0 1px 2px rgb(15 23 42 / 0.04), 0 12px 40px rgb(28 25 23 / 0.1);
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483000;
}

/* Thin scrollbar — light theme */
.li-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgb(180 168 152 / 0.9) transparent;
}
.li-scroll::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.li-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.li-scroll::-webkit-scrollbar-thumb {
  background: rgb(180 168 152 / 0.85);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
.li-scroll::-webkit-scrollbar-thumb:hover {
  background: rgb(140 128 112 / 0.95);
  border: 2px solid transparent;
  background-clip: padding-box;
}

.li-launcher {
  pointer-events: auto;
  position: fixed;
  right: 20px;
  bottom: 20px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--li-border);
  border-radius: 999px;
  background: var(--li-card);
  color: var(--li-fg);
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--li-shadow);
}
.li-launcher:hover {
  background: #fff;
}
.li-launcher-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, #b45309, #64748b);
}
.li-modal {
  pointer-events: auto;
  position: fixed;
  right: 20px;
  bottom: 76px;
  width: min(400px, calc(100vw - 24px));
  height: min(560px, calc(100vh - 110px));
  display: none;
  flex-direction: column;
  border: 1px solid var(--li-border);
  border-radius: 16px;
  background: var(--li-card);
  color: var(--li-fg);
  overflow: hidden;
  box-shadow: var(--li-shadow);
}
.li-modal[data-open="true"] {
  display: flex;
}
.li-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--li-border);
  background: var(--li-raised);
}
.li-logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--li-accent);
  display: inline-block;
  border: 1px solid var(--li-border);
}
.li-title {
  flex: 1;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.li-header button {
  border: 0;
  background: transparent;
  color: var(--li-muted);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}
.li-header button:hover {
  color: var(--li-fg);
}
.li-messages {
  flex: 1;
  overflow: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--li-bg);
}
.li-msg-user {
  align-self: flex-end;
  max-width: 85%;
  background: var(--li-raised);
  border: 1px solid var(--li-border);
  border-radius: 14px 14px 4px 14px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
  color: var(--li-fg);
}
.li-msg-assistant {
  align-self: stretch;
  font-size: 13px;
  line-height: 1.55;
  color: var(--li-fg);
  background: var(--li-card);
  border: 1px solid var(--li-border);
  border-radius: 14px 14px 14px 4px;
  padding: 10px 12px;
}
.li-msg-assistant :first-child { margin-top: 0; }
.li-msg-assistant :last-child { margin-bottom: 0; }
.li-msg-assistant p, .li-msg-assistant ul, .li-msg-assistant ol, .li-msg-assistant pre, .li-msg-assistant table {
  margin: 0 0 0.75em;
}
.li-msg-assistant h1, .li-msg-assistant h2, .li-msg-assistant h3 {
  margin: 0.9em 0 0.4em;
  font-size: 1em;
  font-weight: 700;
  color: var(--li-muted-strong);
}
.li-msg-assistant a { color: var(--li-accent); }
.li-msg-assistant code:not([class*="shj-lang-"]) {
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: var(--li-raised);
  border: 1px solid var(--li-border);
  border-radius: 6px;
  padding: 0.1em 0.35em;
  color: var(--li-muted-strong);
}
.li-pre {
  margin: 0 0 0.75em;
  overflow: auto;
  border-radius: 10px;
  border: 1px solid var(--li-border);
  background: #fff;
  padding: 10px 12px;
}
.li-pre code {
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--li-fg);
}
.li-table-wrap { overflow: auto; margin-bottom: 0.75em; }
.li-msg-assistant table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.li-msg-assistant th, .li-msg-assistant td {
  border: 1px solid var(--li-border);
  padding: 6px 8px;
  text-align: left;
}
.li-msg-assistant th {
  background: var(--li-raised);
  color: var(--li-muted-strong);
}
.li-sources {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--li-border);
  font-size: 12px;
  color: var(--li-muted);
}
.li-sources a {
  color: var(--li-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.li-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.li-examples button {
  border: 1px solid var(--li-border);
  background: var(--li-card);
  color: var(--li-muted-strong);
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 11px;
  cursor: pointer;
}
.li-examples button:hover {
  background: var(--li-raised);
  color: var(--li-fg);
}
.li-footer {
  border-top: 1px solid var(--li-border);
  padding: 10px;
  background: var(--li-raised);
}
.li-form {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.li-form textarea {
  flex: 1;
  resize: none;
  min-height: 42px;
  max-height: 120px;
  border-radius: 12px;
  border: 1px solid var(--li-border);
  background: var(--li-card);
  color: var(--li-fg);
  padding: 10px 12px;
  font: inherit;
  font-size: 13px;
  outline: none;
}
.li-form textarea:focus {
  border-color: color-mix(in srgb, var(--li-accent) 45%, var(--li-border));
  box-shadow: 0 0 0 3px var(--li-accent-soft);
}
.li-form button[type="submit"] {
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 999px;
  background: var(--li-accent);
  color: #fffcf7;
  font-weight: 700;
  cursor: pointer;
}
.li-form button[type="submit"]:hover {
  filter: brightness(1.05);
}
.li-thinking {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--li-muted);
  font-size: 13px;
  padding: 4px 2px;
}
.li-thinking-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--li-accent);
  animation: li-pulse 1s ease-in-out infinite;
}
@keyframes li-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1); }
}
.li-form button:disabled { opacity: 0.5; cursor: not-allowed; }
.li-error { color: #b91c1c; font-size: 12px; margin-bottom: 6px; }
.li-powered {
  margin-top: 6px;
  text-align: center;
  font-size: 10px;
  font-family: ui-monospace, monospace;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--li-muted);
}
`;
}

function citationsHtml(citations: WidgetCitation[]): string {
  if (!citations.length) return "";
  const links = citations
    .map((c, i) => {
      const label = escapeHtml(c.name || c.url || "source");
      const sep = i > 0 ? ", " : "";
      if (!c.url) return `${sep}${label}`;
      return `${sep}<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .join("");
  return `<div class="li-sources"><strong>Sources: </strong>${links}</div>`;
}

function findDataEl(
  event: Event,
  key: "action" | "example",
): HTMLElement | null {
  const attr = key === "action" ? "data-action" : "data-example";
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && node.hasAttribute(attr)) {
      return node;
    }
  }
  return null;
}

export class LedgeIndexChatWidget extends HTMLElement {
  #config: WidgetConfig;
  #busy = false;
  #open = false;
  #bindAbort: AbortController | null = null;

  constructor(config: WidgetConfig) {
    super();
    this.#config = config;
    this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    this.#renderShell();
    this.#bind();
  }

  disconnectedCallback(): void {
    this.#bindAbort?.abort();
    this.#bindAbort = null;
  }

  #renderShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const cfg = this.#config;
    const logo = cfg.projectLogo
      ? `<img class="li-logo" src="${escapeHtml(cfg.projectLogo)}" alt="" />`
      : "";

    const examples =
      cfg.exampleQuestions.length > 0
        ? `<div class="li-examples">${cfg.exampleQuestions
            .map(
              (q) =>
                `<button type="button" data-example="${escapeHtml(q)}">${escapeHtml(q)}</button>`,
            )
            .join("")}</div>`
        : "";

    root.innerHTML = `
      <style>${widgetStyles(cfg.projectColor)}</style>
      <div class="li-root">
        <div class="li-modal" data-open="false" role="dialog" aria-hidden="true">
          <div class="li-header">
            ${logo}
            <div class="li-title">${escapeHtml(cfg.projectName)}</div>
            <button type="button" data-action="new">+ New</button>
            <button type="button" data-action="close" aria-label="Close">✕</button>
          </div>
          <div class="li-messages li-scroll" id="messages">
            <div class="li-msg-assistant" data-welcome>
              <p>Ask anything about the docs.</p>
              ${examples}
            </div>
          </div>
          <div class="li-footer">
            <div class="li-error" id="error" hidden></div>
            <form class="li-form" id="form">
              <textarea id="input" rows="1" placeholder="Ask me a question about ${escapeHtml(cfg.projectName)}…"></textarea>
              <button type="submit" id="send" aria-label="Send">↑</button>
            </form>
            <div class="li-powered">Powered by LedgeIndex</div>
          </div>
        </div>
        <button type="button" class="li-launcher" data-action="toggle" aria-expanded="false">
          <span class="li-launcher-dot"></span>
          <span data-launcher-label>${escapeHtml(cfg.projectName)}</span>
        </button>
      </div>
    `;

    // Preserve open state across shell re-renders (+ New).
    this.#applyOpen(this.#open);
  }

  #bind(): void {
    const root = this.shadowRoot;
    if (!root) return;

    this.#bindAbort?.abort();
    this.#bindAbort = new AbortController();
    const { signal } = this.#bindAbort;

    root.addEventListener(
      "click",
      (event) => {
        const actionEl = findDataEl(event, "action");
        if (actionEl) {
          const action = actionEl.dataset.action;
          if (action === "toggle") this.#setOpen(!this.#open);
          else if (action === "close") this.#setOpen(false);
          else if (action === "new") this.#resetChat();
          return;
        }
        const example = findDataEl(event, "example");
        if (example?.dataset.example) {
          void this.#send(example.dataset.example);
        }
      },
      { signal },
    );

    const form = root.getElementById("form") as HTMLFormElement | null;
    const input = root.getElementById("input") as HTMLTextAreaElement | null;
    form?.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        void this.#send(input?.value ?? "");
      },
      { signal },
    );
    input?.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void this.#send(input.value);
        }
      },
      { signal },
    );
  }

  #setOpen(open: boolean): void {
    this.#open = open;
    this.#applyOpen(open);
  }

  #applyOpen(open: boolean): void {
    const root = this.shadowRoot;
    if (!root) return;
    const modal = root.querySelector(".li-modal");
    const label = root.querySelector("[data-launcher-label]");
    const launcher = root.querySelector(".li-launcher");
    if (!modal || !label) return;
    modal.setAttribute("data-open", open ? "true" : "false");
    modal.setAttribute("aria-hidden", open ? "false" : "true");
    launcher?.setAttribute("aria-expanded", open ? "true" : "false");
    label.textContent = open ? "Close" : this.#config.projectName;
  }

  #resetChat(): void {
    this.#busy = false;
    this.#renderShell();
    this.#bind();
    this.#setOpen(true);
  }

  #setError(message: string | null): void {
    const el = this.shadowRoot?.getElementById("error");
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  #setBusy(busy: boolean): void {
    this.#busy = busy;
    const send = this.shadowRoot?.getElementById("send") as HTMLButtonElement | null;
    const input = this.shadowRoot?.getElementById("input") as HTMLTextAreaElement | null;
    if (send) send.disabled = busy;
    if (input) input.disabled = busy;
  }

  async #send(raw: string): Promise<void> {
    const message = raw.trim();
    if (!message || this.#busy) return;
    if (!this.#config.websiteId) {
      this.#setError("Missing data-website-id on the widget script.");
      return;
    }

    this.#setOpen(true);
    this.#setError(null);
    this.#setBusy(true);

    const messages = this.shadowRoot?.getElementById("messages");
    const input = this.shadowRoot?.getElementById("input") as HTMLTextAreaElement | null;
    if (!messages) {
      this.#setBusy(false);
      return;
    }

    messages.querySelector("[data-welcome]")?.remove();
    if (input) input.value = "";

    const user = document.createElement("div");
    user.className = "li-msg-user";
    user.textContent = message;
    messages.appendChild(user);

    const thinking = document.createElement("div");
    thinking.className = "li-thinking";
    thinking.dataset.thinking = "1";
    thinking.setAttribute("aria-live", "polite");
    thinking.innerHTML =
      '<span class="li-thinking-dot" aria-hidden="true"></span><span>Thinking…</span>';
    messages.appendChild(thinking);
    messages.scrollTop = messages.scrollHeight;

    const assistant = document.createElement("div");
    assistant.className = "li-msg-assistant";
    assistant.hidden = true;
    messages.appendChild(assistant);

    let answer = "";
    let renderQueued = false;
    const queueRender = () => {
      if (renderQueued) return;
      renderQueued = true;
      requestAnimationFrame(() => {
        renderQueued = false;
        assistant.innerHTML = marked.parse(answer, { async: false }) as string;
        messages.scrollTop = messages.scrollHeight;
      });
    };

    try {
      const result = await askWidgetStream(this.#config, message, {
        onToken: (text) => {
          if (thinking.isConnected) thinking.remove();
          if (assistant.hidden) assistant.hidden = false;
          answer += text;
          queueRender();
        },
      });

      thinking.remove();
      if (assistant.hidden) assistant.hidden = false;
      answer = result.answer || answer || "No answer returned.";
      await this.#finalizeAssistant(assistant, answer, result.citations);
    } catch (err) {
      thinking.remove();
      assistant.remove();
      this.#setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      this.#setBusy(false);
      messages.scrollTop = messages.scrollHeight;
    }
  }

  async #finalizeAssistant(
    wrap: HTMLElement,
    markdown: string,
    citations: WidgetCitation[],
  ): Promise<void> {
    wrap.innerHTML = marked.parse(markdown, { async: false }) as string;

    wrap.querySelectorAll("table").forEach((table) => {
      const holder = document.createElement("div");
      holder.className = "li-table-wrap li-scroll";
      table.replaceWith(holder);
      holder.appendChild(table);
    });

    wrap.insertAdjacentHTML("beforeend", citationsHtml(citations));

    const codeBlocks = wrap.querySelectorAll("code[class*='shj-lang-']");
    for (const block of codeBlocks) {
      try {
        await highlightElement(block, undefined, "multiline", {
          hideLineNumbers: true,
        });
      } catch {
        // Unknown language — leave escaped plain code.
      }
    }
  }
}

export function mountWidget(config: WidgetConfig): { unmount: () => void } {
  const existing = document.querySelector("ledgeindex-chat-widget");
  existing?.remove();

  if (!customElements.get("ledgeindex-chat-widget")) {
    customElements.define("ledgeindex-chat-widget", LedgeIndexChatWidget);
  }

  const el = new LedgeIndexChatWidget(config);
  document.body.appendChild(el);
  return {
    unmount: () => el.remove(),
  };
}
