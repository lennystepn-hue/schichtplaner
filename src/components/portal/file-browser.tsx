"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  Folder,
  FileText,
  Plus,
  Upload,
  ChevronRight,
  Home,
  Pencil,
  Trash2,
  MoreHorizontal,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface FolderItem {
  id: string;
  name: string;
  createdAt: string;
}

interface FileItem {
  id: string;
  name: string;
  path: string;
  size: number;
  mimeType: string | null;
  createdAt: string;
  uploadedBy: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

interface BreadcrumbItem {
  id: string;
  name: string;
}

export function FileBrowser() {
  const queryClient = useQueryClient();
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string; type: "folder" | "file" } | null>(null);
  const [renameName, setRenameName] = useState("");

  const { data, isLoading } = useQuery<{
    folders: FolderItem[];
    files: FileItem[];
    breadcrumb: BreadcrumbItem[];
  }>({
    queryKey: ["files", currentFolderId],
    queryFn: () => {
      const url = currentFolderId
        ? `/api/files?folderId=${currentFolderId}`
        : "/api/files";
      return fetch(url).then((r) => r.json());
    },
  });

  const folders = data?.folders ?? [];
  const files = data?.files ?? [];
  const breadcrumb = data?.breadcrumb ?? [];

  const createFolderMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: folderName, parentId: currentFolderId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      toast.success("Ordner erstellt");
      setFolderName("");
      setCreateFolderOpen(false);
    },
    onError: (error: Error) => {
      toast.error(error.message === "Forbidden" ? "Keine Berechtigung" : "Fehler beim Erstellen");
    },
  });

  const renameMutation = useMutation({
    mutationFn: async () => {
      if (!renameTarget) return;
      const res = await fetch(`/api/files/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameName }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      toast.success("Umbenannt");
      setRenameTarget(null);
      setRenameName("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      toast.success("Geloescht");
    },
    onError: () => {
      toast.error("Fehler beim Loeschen");
    },
  });

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="flex-1">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-[22px] leading-none font-[560] tracking-[-0.03em]">Dateien</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2"
            disabled
            title="Datei-Upload kommt bald"
          >
            <Upload className="size-4" />
            Datei hochladen
          </Button>
          <Button onClick={() => setCreateFolderOpen(true)} className="gap-2">
            <Plus className="size-4" />
            Neuer Ordner
          </Button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-1 text-sm">
        <button
          onClick={() => setCurrentFolderId(null)}
          className={cn(
            "flex items-center gap-1 rounded px-2 py-1 transition-colors",
            !currentFolderId
              ? "font-medium text-primary"
              : "text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-muted-foreground"
          )}
        >
          <Home className="size-3.5" />
          Stammordner
        </button>
        {breadcrumb.map((item) => (
          <span key={item.id} className="flex items-center gap-1">
            <ChevronRight className="size-3.5 text-muted-foreground" />
            <button
              onClick={() => setCurrentFolderId(item.id)}
              className={cn(
                "rounded px-2 py-1 transition-colors",
                currentFolderId === item.id
                  ? "font-medium text-primary"
                  : "text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-muted-foreground"
              )}
            >
              {item.name}
            </button>
          </span>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : folders.length === 0 && files.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-muted-foreground">
          <Folder className="mb-3 size-10 text-muted-foreground" />
          <p className="text-sm">Dieser Ordner ist leer</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Folders */}
          {folders.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ordner
              </h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {folders.map((folder) => (
                  <div
                    key={folder.id}
                    className="group relative flex cursor-pointer flex-col items-center gap-2 akro-panel p-4 transition-all hover:border-primary/40 hover:shadow-sm"
                    onClick={() => setCurrentFolderId(folder.id)}
                  >
                    <Folder className="size-10 text-primary" />
                    <span className="text-sm font-medium text-center truncate w-full">
                      {folder.name}
                    </span>

                    {/* Actions */}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-7 p-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenameTarget({ id: folder.id, name: folder.name, type: "folder" });
                              setRenameName(folder.name);
                            }}
                          >
                            <Pencil className="mr-2 size-4" />
                            Umbenennen
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMutation.mutate(folder.id);
                            }}
                          >
                            <Trash2 className="mr-2 size-4" />
                            Loeschen
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Files */}
          {files.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Dateien
              </h3>
              <div className="divide-y akro-panel">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="group flex items-center gap-3 px-4 py-3"
                  >
                    <FileText className="size-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{file.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatSize(file.size)} &middot;{" "}
                        {file.uploadedBy.firstName} {file.uploadedBy.lastName} &middot;{" "}
                        {format(new Date(file.createdAt), "dd. MMM yyyy", { locale: de })}
                      </div>
                    </div>

                    <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="size-7 p-0">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setRenameTarget({ id: file.id, name: file.name, type: "file" });
                              setRenameName(file.name);
                            }}
                          >
                            <Pencil className="mr-2 size-4" />
                            Umbenennen
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => deleteMutation.mutate(file.id)}
                          >
                            <Trash2 className="mr-2 size-4" />
                            Loeschen
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create folder dialog */}
      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Neuer Ordner</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Ordnername</Label>
              <Input
                className="mt-1.5"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="Name eingeben..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && folderName.trim()) createFolderMutation.mutate();
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateFolderOpen(false)}>
                Abbrechen
              </Button>
              <Button
                onClick={() => createFolderMutation.mutate()}
                disabled={!folderName.trim() || createFolderMutation.isPending}
              >
                {createFolderMutation.isPending ? "Erstelle..." : "Erstellen"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {renameTarget?.type === "folder" ? "Ordner" : "Datei"} umbenennen
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Neuer Name</Label>
              <Input
                className="mt-1.5"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && renameName.trim()) renameMutation.mutate();
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRenameTarget(null)}>
                Abbrechen
              </Button>
              <Button
                onClick={() => renameMutation.mutate()}
                disabled={!renameName.trim() || renameMutation.isPending}
              >
                {renameMutation.isPending ? "Speichere..." : "Speichern"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
