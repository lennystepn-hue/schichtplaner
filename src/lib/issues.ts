import { z } from "zod";

export const issueInput = z.object({
  title: z.string().trim().min(1, "Titel fehlt.").max(160),
  description: z.string().trim().min(1, "Beschreibung fehlt.").max(5000),
  assigneeMemberId: z.string().min(1).nullable().optional(),
});

export const issuePatch = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).optional(),
  assigneeMemberId: z.string().min(1).nullable().optional(),
});

export const issueSelect = {
  id: true, title: true, description: true, status: true, createdAt: true, updatedAt: true, resolvedAt: true, branchId: true,
  assignee: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
  createdBy: { select: { firstName: true, lastName: true } },
} as const;
