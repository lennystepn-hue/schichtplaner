"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  Mail,
  MailOpen,
  Trash2,
  RotateCcw,
  MailPlus,
  CheckSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ComposeMessage } from "./compose-message";

interface Recipient {
  userId: string;
  isRead: boolean;
  isDeleted: boolean;
  user?: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

interface MessageItem {
  id: string;
  subject: string;
  body: string;
  createdAt: string;
  sender: {
    id: string;
    firstName: string;
    lastName: string;
    profileImage: string | null;
  };
  recipients: Recipient[];
  hiddenRecipients?: number;
}

interface Props {
  folder: "inbox" | "sent" | "trash";
}

export function MessageList({ folder }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [composeOpen, setComposeOpen] = useState(false);

  const { data, isLoading } = useQuery<{ messages: MessageItem[]; unreadCount?: number }>({
    queryKey: ["messages", folder],
    queryFn: () => fetch(`/api/messages?folder=${folder}`).then((r) => r.json()),
  });

  const messages = data?.messages ?? [];

  const patchMutation = useMutation({
    mutationFn: async ({ ids, patch }: { ids: string[]; patch: Record<string, boolean> }) => {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/messages/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setSelected(new Set());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/messages/${id}`, { method: "DELETE" })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setSelected(new Set());
      toast.success("Nachrichten geloescht");
    },
  });

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === messages.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(messages.map((m) => m.id)));
    }
  }

  function isUnread(msg: MessageItem) {
    if (folder === "sent") return false;
    return msg.recipients?.[0]?.isRead === false;
  }

  const folderLabels = {
    inbox: "Posteingang",
    sent: "Gesendete",
    trash: "Papierkorb",
  };

  return (
    <div className="flex-1">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-[22px] leading-none font-[560] tracking-[-0.03em]">{folderLabels[folder]}</h1>
        <Button onClick={() => setComposeOpen(true)} className="gap-2">
          <MailPlus className="size-4" />
          Neue Nachricht
        </Button>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-md bg-muted p-2">
          <span className="text-sm text-muted-foreground">
            {selected.size} ausgewaehlt
          </span>
          {folder === "inbox" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  patchMutation.mutate({ ids: Array.from(selected), patch: { isRead: true } })
                }
              >
                <MailOpen className="mr-1 size-4" />
                Gelesen
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  patchMutation.mutate({ ids: Array.from(selected), patch: { isDeleted: true } })
                }
              >
                <Trash2 className="mr-1 size-4" />
                Loeschen
              </Button>
            </>
          )}
          {folder === "trash" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  patchMutation.mutate({ ids: Array.from(selected), patch: { isDeleted: false } })
                }
              >
                <RotateCcw className="mr-1 size-4" />
                Wiederherstellen
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => deleteMutation.mutate(Array.from(selected))}
              >
                <Trash2 className="mr-1 size-4" />
                Endgueltig loeschen
              </Button>
            </>
          )}
        </div>
      )}

      {/* Message list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-muted-foreground">
          <Mail className="mb-3 size-10 text-muted-foreground" />
          <p className="text-sm">
            {folder === "inbox" && "Keine Nachrichten im Posteingang"}
            {folder === "sent" && "Keine gesendeten Nachrichten"}
            {folder === "trash" && "Papierkorb ist leer"}
          </p>
        </div>
      ) : (
        <div className="divide-y akro-panel">
          {/* Select all */}
          <div className="flex items-center gap-3 px-4 py-2 bg-muted/50">
            <Checkbox
              checked={selected.size === messages.length && messages.length > 0}
              onCheckedChange={toggleAll}
            />
            <button
              onClick={toggleAll}
              className="text-xs text-muted-foreground hover:text-foreground dark:text-muted-foreground"
            >
              <CheckSquare className="mr-1 inline size-3" />
              Alle
            </button>
          </div>

          {messages.map((msg) => {
            const unread = isUnread(msg);
            return (
              <div
                key={msg.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50",
                  unread && "bg-accent/50"
                )}
              >
                <Checkbox
                  checked={selected.has(msg.id)}
                  onCheckedChange={() => toggleSelect(msg.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div
                  className="flex min-w-0 flex-1 items-center gap-3"
                  onClick={() => router.push(`/portal/inbox?id=${msg.id}`)}
                >
                  {/* Unread indicator */}
                  <div className={cn("size-2 shrink-0 rounded-full", unread ? "bg-primary" : "bg-transparent")} />

                  {/* Sender/recipient */}
                  <div className="w-36 shrink-0 truncate">
                    <span className={cn("text-sm", unread && "font-semibold")}>
                      {folder === "sent"
                        ? [
                            ...msg.recipients.map((r) =>
                              r.user ? `${r.user.firstName} ${r.user.lastName}` : "Unbekannt"
                            ),
                            ...(msg.hiddenRecipients ? [`+${msg.hiddenRecipients} weitere`] : []),
                          ].join(", ")
                        : `${msg.sender.firstName} ${msg.sender.lastName}`}
                    </span>
                  </div>

                  {/* Subject + preview */}
                  <div className="min-w-0 flex-1">
                    <span className={cn("text-sm", unread && "font-semibold")}>
                      {msg.subject}
                    </span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {msg.body.length > 80 ? msg.body.slice(0, 80) + "..." : msg.body}
                    </span>
                  </div>

                  {/* Date */}
                  <time className="shrink-0 text-xs text-muted-foreground">
                    {format(new Date(msg.createdAt), "dd. MMM yyyy, HH:mm", { locale: de })}
                  </time>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ComposeMessage open={composeOpen} onOpenChange={setComposeOpen} />
    </div>
  );
}
