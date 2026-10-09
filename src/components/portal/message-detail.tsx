"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  ArrowLeft,
  Reply,
  Trash2,
  Send,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

interface UserInfo {
  id: string;
  firstName: string;
  lastName: string;
  profileImage: string | null;
}

interface ReplyMsg {
  id: string;
  subject: string;
  body: string;
  createdAt: string;
  sender: UserInfo;
}

interface MessageFull {
  id: string;
  subject: string;
  body: string;
  createdAt: string;
  parentId: string | null;
  sender: UserInfo;
  recipients: {
    userId: string;
    isRead: boolean;
    isDeleted: boolean;
    user: UserInfo;
  }[];
  replies: ReplyMsg[];
  /** Weitere Empfaenger, deren Namen die betrachtende Person nicht sehen darf. */
  hiddenRecipients?: number;
}

export function MessageDetail() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const messageId = searchParams.get("id");
  const queryClient = useQueryClient();
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");

  const { data, isLoading } = useQuery<{ message: MessageFull }>({
    queryKey: ["messages", "detail", messageId],
    queryFn: () => fetch(`/api/messages/${messageId}`).then((r) => r.json()),
    enabled: !!messageId,
  });

  const replyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/messages/${messageId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyText }),
      });
      if (!res.ok) throw new Error("Failed to reply");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      toast.success("Antwort gesendet");
      setReplyText("");
      setReplyOpen(false);
    },
  });

  const trashMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDeleted: true }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      toast.success("In den Papierkorb verschoben");
      router.push("/portal/inbox");
    },
  });

  if (!messageId) return null;

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const msg = data?.message;
  if (!msg) {
    return (
      <div className="flex-1">
        <Button variant="ghost" onClick={() => router.push("/portal/inbox")} className="gap-2 mb-4">
          <ArrowLeft className="size-4" />
          Zurueck
        </Button>
        <p className="text-muted-foreground">Nachricht nicht gefunden.</p>
      </div>
    );
  }

  function initials(user: UserInfo) {
    return (user.firstName[0] + user.lastName[0]).toUpperCase();
  }

  return (
    <div className="flex-1">
      {/* Back button */}
      <Button variant="ghost" onClick={() => router.push("/portal/inbox")} className="gap-2 mb-4">
        <ArrowLeft className="size-4" />
        Zurueck
      </Button>

      <div className="akro-panel p-6">
        {/* Subject */}
        <h2 className="text-xl font-bold mb-4">{msg.subject}</h2>

        {/* Sender info */}
        <div className="flex items-start gap-3 mb-4">
          <Avatar className="size-10">
            <AvatarFallback className="bg-accent text-primary dark:text-primary">
              {initials(msg.sender)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">
                {msg.sender.firstName} {msg.sender.lastName}
              </span>
              <time className="text-xs text-muted-foreground">
                {format(new Date(msg.createdAt), "dd. MMMM yyyy, HH:mm", { locale: de })}
              </time>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              <User className="size-3" />
              An:{" "}
              {msg.recipients.map((r) => `${r.user.firstName} ${r.user.lastName} (${r.isRead ? "gelesen" : "ungelesen"})`).join(", ")}
              {msg.hiddenRecipients ? `${msg.recipients.length ? " und " : ""}${msg.hiddenRecipients} ${msg.hiddenRecipients === 1 ? "weitere Person" : "weitere Personen"}` : ""}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {msg.body}
        </div>

        {/* Replies */}
        {msg.replies.length > 0 && (
          <>
            <Separator className="my-6" />
            <h3 className="mb-4 text-sm font-semibold text-muted-foreground">
              Antworten ({msg.replies.length})
            </h3>
            <div className="space-y-4">
              {msg.replies.map((reply) => (
                <div key={reply.id} className="rounded-md border-l-2 border-primary/30 bg-muted p-4/50">
                  <div className="mb-2 flex items-center gap-2">
                    <Avatar className="size-7">
                      <AvatarFallback className="text-xs bg-accent text-primary dark:text-primary">
                        {initials(reply.sender)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">
                      {reply.sender.firstName} {reply.sender.lastName}
                    </span>
                    <time className="text-xs text-muted-foreground">
                      {format(new Date(reply.createdAt), "dd. MMM yyyy, HH:mm", { locale: de })}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-foreground">
                    {reply.body}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Actions */}
        <Separator className="my-6" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setReplyOpen(!replyOpen)} className="gap-2">
            <Reply className="size-4" />
            Antworten
          </Button>
          <Button
            variant="outline"
            className="gap-2 text-destructive hover:text-destructive"
            onClick={() => trashMutation.mutate()}
          >
            <Trash2 className="size-4" />
            Loeschen
          </Button>
        </div>

        {/* Reply form */}
        {replyOpen && (
          <div className="mt-4 space-y-3">
            <Textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Antwort schreiben..."
              className="min-h-[100px]"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setReplyOpen(false);
                  setReplyText("");
                }}
              >
                Abbrechen
              </Button>
              <Button
                onClick={() => replyMutation.mutate()}
                disabled={!replyText.trim() || replyMutation.isPending}
                className="gap-2"
              >
                <Send className="size-4" />
                {replyMutation.isPending ? "Sende..." : "Antwort senden"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
