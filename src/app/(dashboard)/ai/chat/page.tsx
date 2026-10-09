"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, Send, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ChatMessages,
  type ChatMessageData,
  type ToolResultInfo,
} from "@/components/ai/chat-messages";

// ─── Types ──────────────────────────────────────────────────────────

interface ChatApiResponse {
  message: string;
  toolResults: ToolResultInfo[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ─── Page ───────────────────────────────────────────────────────────

export default function AiChatPage() {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgIdCounter = useRef(0);

  const genId = () => {
    msgIdCounter.current++;
    return `msg-${msgIdCounter.current}`;
  };

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Chat mutation
  const chatMutation = useMutation({
    mutationFn: async (
      userMessages: Array<{ role: "user" | "assistant"; content: string }>
    ): Promise<ChatApiResponse> => {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: userMessages }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Senden");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setMessages((prev) => {
        const withoutLoading = prev.filter((m) => !m.isLoading);
        return [
          ...withoutLoading,
          {
            id: genId(),
            role: "assistant" as const,
            content: data.message,
            timestamp: new Date(),
            toolResults: data.toolResults,
          },
        ];
      });
    },
    onError: (error: Error) => {
      setMessages((prev) => {
        const withoutLoading = prev.filter((m) => !m.isLoading);
        return [
          ...withoutLoading,
          {
            id: genId(),
            role: "assistant" as const,
            content: `Fehler: ${error.message}`,
            timestamp: new Date(),
          },
        ];
      });
    },
  });

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || chatMutation.isPending) return;

    const userMessage: ChatMessageData = {
      id: genId(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    const loadingMessage: ChatMessageData = {
      id: genId(),
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isLoading: true,
    };

    const newMessages = [...messages, userMessage];
    setMessages([...newMessages, loadingMessage]);
    setInput("");

    const apiMessages = newMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    chatMutation.mutate(apiMessages);
  }, [input, messages, chatMutation]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([]);
  };

  // Quick action suggestions
  const suggestions = [
    "Zeig mir den Schichtplan fuer diese Woche",
    "Welche Mitarbeiter sind naechste Woche abwesend?",
    "Wer hat die meisten Stunden diesen Monat?",
    "Suche Mitarbeiter mit dem Namen...",
  ];

  const handleSuggestion = (text: string) => {
    setInput(text);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-accent">
            <Sparkles className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-[22px] leading-none font-[560] tracking-[-0.03em]">KI-Assistent</h1>
            <p className="text-sm text-muted-foreground">
              Frag mich alles rund um deinen Schichtplan
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/ai/insights">
            <Button variant="outline" size="sm">
              Insights & Prognosen
            </Button>
          </Link>
          {messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClear}
              className="gap-1.5"
            >
              <Trash2 className="size-3.5" />
              Chat leeren
            </Button>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col akro-panel overflow-hidden">
        {/* Messages */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8">
              <Sparkles className="size-12 text-primary mb-4" />
              <h2 className="text-lg font-semibold mb-2">
                Wie kann ich dir helfen?
              </h2>
              <p className="text-sm text-muted-foreground text-center max-w-md mb-6">
                Ich kann Schichtplaene anzeigen, Mitarbeiter suchen, Stunden
                berechnen, Abwesenheiten pruefen und sogar Schichten erstellen
                oder Mitarbeiter einbuchen.
              </p>

              {/* Suggestions */}
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {suggestions.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSuggestion(s)}
                    className="rounded-lg border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ChatMessages messages={messages} />
          )}
        </div>

        {/* Input */}
        <div className="border-t p-4">
          <div className="flex items-end gap-3 max-w-3xl mx-auto">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Nachricht eingeben... (Enter zum Senden, Shift+Enter fuer Zeilenumbruch)"
              className={cn(
                "flex-1 resize-none rounded-xl border bg-muted px-4 py-3 text-sm",
                "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
                "min-h-[44px] max-h-[120px]"
              )}
              rows={1}
              disabled={chatMutation.isPending}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || chatMutation.isPending}
              className="h-[44px] px-4 rounded-xl"
            >
              {chatMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
