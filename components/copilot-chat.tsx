"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { play } from "@/lib/sfx";

export type ChatMessage = { role: "user" | "assistant"; content: string; error?: boolean };

const MAX_QUESTION = 500;
/** Turns sent back as context (the server caps this too). */
const HISTORY = 10;

export const STARTERS = [
  "How are we doing today?",
  "Explain Vanguard's strategy",
  "What's a profit factor?",
  "Why are crypto entries off?",
];

/**
 * JC-316 comms state. Lives in the dock (not the panel) so a briefing can interrupt the chat without
 * losing it. Nothing is persisted: the conversation exists only in this tab's memory.
 */
export function useChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function send(text = draft) {
    const q = text.trim().slice(0, MAX_QUESTION);
    if (!q || busy) return;
    const history: ChatMessage[] = [...messages.filter((m) => !m.error), { role: "user", content: q }];
    setMessages([...messages, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setDraft("");
    setBusy(true);
    play("click");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const update = (content: string, error = false) =>
      setMessages((ms) => [...ms.slice(0, -1), { role: "assistant", content, error }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-HISTORY * 2).map(({ role, content }) => ({ role, content })) }),
        signal: ctrl.signal,
      });
      const left = res.headers.get("X-Chat-Remaining");
      if (left !== null) setRemaining(Number(left));
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 429 && /today/.test(body.error ?? "")) setRemaining(0);
        update(body.error ?? "Signal lost. Try again, pilot.", true);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        update(text);
      }
      update(text.trim() || "No reply came through, pilot.", !text.trim());
    } catch (e) {
      if ((e as Error).name !== "AbortError") update("Signal lost. Try again, pilot.", true);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const close = () => {
    abortRef.current?.abort();
    setOpen(false);
  };
  /** Open comms with a question pre-filled (e.g. from a briefing). */
  const ask = (question: string) => {
    setDraft(question);
    setOpen(true);
  };

  return { open, setOpen, close, ask, messages, draft, setDraft, busy, remaining, send };
}

export type Chat = ReturnType<typeof useChat>;

/** The comms panel body: transcript, starters, input. The dock supplies the frame and positioning. */
export function ChatPanel({ chat, header }: { chat: Chat; header: ReactNode }) {
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const last = chat.messages.at(-1)?.content;
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [chat.messages.length, last]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const out = chat.remaining === 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {header}
      <div ref={logRef} className="mt-2 grid max-h-[min(42vh,340px)] min-h-24 content-start gap-2.5 overflow-y-auto pr-1" aria-live="polite">
        {chat.messages.length === 0 && (
          <div>
            <p className="text-[13px] leading-snug text-ink-2">
              Ask me about the account, the units, or how markets work. I only see this dashboard&apos;s data, not the news.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => chat.send(s)}
                  disabled={chat.busy || out}
                  className="hud border border-line-2 px-2 py-1 text-[11px] text-ink-2 hover:border-amber hover:text-amber disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.messages.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="ml-8 justify-self-end border border-line-2 bg-surface-2/70 px-2.5 py-1.5 text-[13px] leading-snug text-ink">
              {m.content}
            </p>
          ) : (
            <div key={i}>
              <div className={`hud text-[10px] ${m.error ? "text-alert" : "text-amber"}`}>JC-316</div>
              <p className={`mt-0.5 text-[13px] leading-snug whitespace-pre-wrap ${m.error ? "text-alert" : "text-ink"}`}>
                {m.content}
                {chat.busy && i === chat.messages.length - 1 && (
                  <span aria-hidden className="blink ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-sync" />
                )}
              </p>
            </div>
          ),
        )}
      </div>
      <form
        className="mt-2.5 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void chat.send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={2}
          value={chat.draft}
          maxLength={MAX_QUESTION}
          disabled={out}
          onChange={(e) => chat.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void chat.send();
            }
          }}
          placeholder={out ? "Daily comms used up. Back after midnight ET." : "Ask JC-316…"}
          aria-label="Message JC-316"
          className="min-w-0 flex-1 resize-none border border-line-2 bg-page px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted focus:border-amber"
        />
        <button
          type="submit"
          disabled={chat.busy || out || !chat.draft.trim()}
          className="hud slant bg-amber px-3.5 py-2 text-[13px] text-[#0b0a10] disabled:opacity-40"
        >
          <span className="unslant inline-block">{chat.busy ? "…" : "Send"}</span>
        </button>
      </form>
      <div className="mt-1.5 flex justify-between gap-2 text-[10px] text-muted">
        <span>Paper account · not investment advice · not saved</span>
        <span className="num">
          {chat.draft.length > MAX_QUESTION - 80 ? `${chat.draft.length}/${MAX_QUESTION}` : chat.remaining !== null ? `${chat.remaining} left today` : ""}
        </span>
      </div>
    </div>
  );
}
