"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  MessageCircle,
  Plus,
  Clock,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface TopicItem {
  id: string;
  title: string;
  createdAt: string;
  creator: {
    id: string;
    firstName: string;
    lastName: string;
    profileImage: string | null;
  } | null;
  postCount: number;
  lastActivity: string;
}

export function TopicList() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");

  const { data, isLoading } = useQuery<{ topics: TopicItem[] }>({
    queryKey: ["topics"],
    queryFn: () => fetch("/api/topics").then((r) => r.json()),
  });

  const topics = data?.topics ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["topics"] });
      toast.success("Thema erstellt");
      setTitle("");
      setCreateOpen(false);
      if (data.topic?.id) {
        router.push(`/portal/topics/${data.topic.id}`);
      }
    },
    onError: () => {
      toast.error("Fehler beim Erstellen");
    },
  });

  return (
    <div className="flex-1">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-[22px] leading-none font-[560] tracking-[-0.03em]">Themen</h1>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="size-4" />
          Neues Thema
        </Button>
      </div>

      {/* Topic list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : topics.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-muted-foreground">
          <MessageCircle className="mb-3 size-10 text-muted-foreground" />
          <p className="text-sm">Noch keine Themen vorhanden</p>
          <Button variant="outline" className="mt-4" onClick={() => setCreateOpen(true)}>
            Erstes Thema erstellen
          </Button>
        </div>
      ) : (
        <div className="divide-y akro-panel">
          {topics.map((topic) => (
            <div
              key={topic.id}
              className="flex cursor-pointer items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/50"
              onClick={() => router.push(`/portal/topics/${topic.id}`)}
            >
              <div className="flex size-10 items-center justify-center rounded-full bg-accent text-primary dark:text-primary">
                <MessageCircle className="size-5" />
              </div>

              <div className="min-w-0 flex-1">
                <h3 className="font-medium truncate">{topic.title}</h3>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                  {topic.creator && (
                    <span className="flex items-center gap-1">
                      <User className="size-3" />
                      {topic.creator.firstName} {topic.creator.lastName}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {format(new Date(topic.createdAt), "dd. MMM yyyy", { locale: de })}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-4 shrink-0">
                <Badge variant="secondary" className="gap-1">
                  <MessageCircle className="size-3" />
                  {topic.postCount}
                </Badge>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">
                    Letzte Aktivitaet
                  </div>
                  <div className="text-xs font-medium text-muted-foreground">
                    {format(new Date(topic.lastActivity), "dd. MMM yyyy, HH:mm", { locale: de })}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create topic dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Neues Thema erstellen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Titel</Label>
              <Input
                className="mt-1.5"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Thema eingeben..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && title.trim()) createMutation.mutate();
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Abbrechen
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!title.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "Erstelle..." : "Erstellen"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
