"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, X, Send, Maximize2, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ChatMessages,
  type ChatMessageData,
  type ToolResultInfo,
} from "./chat-messages";

// ─── Types ──────────────────────────────────────────────────────────

interface ChatApiResponse {
  message: string;
  toolResults: ToolResultInfo[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ─── Chat Widget ────────────────────────────────────────────────────

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgIdCounter = useRef(0);

  const genId = () => {
    msgIdCounter.current++;
    return `msg-${msgIdCounter.current}`;
  };

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

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
      // Remove loading message and add real response
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
      // Remove loading message and add error message
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

    // Add user message
    const userMessage: ChatMessageData = {
      id: genId(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    // Add loading message
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

    // Build messages for API (strip extra fields)
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

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primary transition-all hover:scale-105 active:scale-95"
          aria-label="KI-Chat oeffnen"
        >
          <Sparkles className="size-6" />
        </button>
      )}

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col w-[400px] h-[520px] rounded-2xl bg-card border shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-primary text-white">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5" />
              <span className="font-semibold text-sm">KI-Assistent</span>
            </div>
            <div className="flex items-center gap-1">
              <Link
                href="/ai/chat"
                className="rounded-md p-1 hover:bg-primary transition-colors"
                title="Vollbild oeffnen"
              >
                <Maximize2 className="size-4" />
              </Link>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-md p-1 hover:bg-primary transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <ChatMessages messages={messages} />

          {/* Input */}
          <div className="border-t p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Nachricht eingeben..."
                className={cn(
                  "flex-1 resize-none rounded-lg border bg-muted px-3 py-2 text-sm",
                  "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
                  "min-h-[38px] max-h-[100px]"
                )}
                rows={1}
                disabled={chatMutation.isPending}
              />
              <Button
                size="sm"
                onClick={handleSend}
                disabled={!input.trim() || chatMutation.isPending}
                className="h-[38px] w-[38px] p-0 rounded-lg"
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
      )}
    </>
  );
}
