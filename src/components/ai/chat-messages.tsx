"use client";

import { useRef, useEffect } from "react";
import { Bot, User, Wrench, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────

export interface ToolResultInfo {
  toolName: string;
  toolInput: Record<string, unknown>;
  result: string;
  requiresConfirmation: boolean;
}

export interface ChatMessageData {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  toolResults?: ToolResultInfo[];
  isLoading?: boolean;
}

// ─── Tool name display mapping ──────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  getSchedule: "Schichtplan abgerufen",
  getEmployeeHours: "Stunden abgerufen",
  searchEmployees: "Mitarbeiter gesucht",
  createShift: "Schicht erstellt",
  bookEmployee: "Mitarbeiter eingebucht",
  getAbsences: "Abwesenheiten abgerufen",
};

// ─── Component ──────────────────────────────────────────────────────

interface ChatMessagesProps {
  messages: ChatMessageData[];
}

export function ChatMessages({ messages }: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="space-y-2">
          <Bot className="mx-auto size-10 text-primary" />
          <p className="text-sm font-medium text-muted-foreground">
            Hallo! Ich bin dein KI-Assistent.
          </p>
          <p className="text-xs text-muted-foreground max-w-[260px]">
            Frag mich nach Schichtplaenen, Mitarbeitern, Stunden oder
            Abwesenheiten. Ich kann auch Schichten erstellen oder Mitarbeiter
            einbuchen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
      {messages.map((msg) => (
        <div key={msg.id}>
          {/* Message bubble */}
          <div
            className={cn(
              "flex gap-2",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {msg.role === "assistant" && (
              <div className="flex-shrink-0 size-7 rounded-full bg-accent flex items-center justify-center">
                <Bot className="size-4 text-primary" />
              </div>
            )}

            <div
              className={cn(
                "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                msg.role === "user"
                  ? "bg-primary text-white"
                  : "bg-muted text-foreground"
              )}
            >
              {msg.isLoading ? (
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-current animate-bounce" />
                  <span
                    className="size-1.5 rounded-full bg-current animate-bounce"
                    style={{ animationDelay: "0.15s" }}
                  />
                  <span
                    className="size-1.5 rounded-full bg-current animate-bounce"
                    style={{ animationDelay: "0.3s" }}
                  />
                </div>
              ) : (
                <div className="whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
              )}
            </div>

            {msg.role === "user" && (
              <div className="flex-shrink-0 size-7 rounded-full bg-primary flex items-center justify-center">
                <User className="size-4 text-white" />
              </div>
            )}
          </div>

          {/* Tool results (shown below assistant messages) */}
          {msg.toolResults && msg.toolResults.length > 0 && (
            <div className="ml-9 mt-1.5 space-y-1.5">
              {msg.toolResults.map((tool, idx) => (
                <ToolResultCard key={idx} tool={tool} />
              ))}
            </div>
          )}

          {/* Timestamp */}
          <div
            className={cn(
              "mt-0.5 text-[10px] text-muted-foreground",
              msg.role === "user" ? "text-right mr-9" : "ml-9"
            )}
          >
            {formatTime(msg.timestamp)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tool Result Card ──────────────────────────────────────────────

function ToolResultCard({ tool }: { tool: ToolResultInfo }) {
  const label = TOOL_LABELS[tool.toolName] ?? tool.toolName;

  return (
    <div className="akro-panel p-2 text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {tool.requiresConfirmation ? (
          <AlertTriangle className="size-3 text-warn" />
        ) : (
          <Wrench className="size-3" />
        )}
        <span className="font-medium">{label}</span>
        {tool.requiresConfirmation && (
          <span className="text-warn dark:text-warn text-[10px]">
            (Aktion ausgefuehrt)
          </span>
        )}
      </div>
      <div className="text-muted-foreground whitespace-pre-wrap line-clamp-4">
        {tool.result}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
