import { z } from "zod";

export const customerInput = z.object({
  name: z.string().trim().min(1, "Name fehlt.").max(120),
  notes: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

const branchFields = {
  customerId: z.string().min(1, "Bitte einen Kunden wählen."),
  name: z.string().trim().min(1, "Name fehlt.").max(100),
  address: z.string().max(500),
  meetingPoint: z.string().max(500),
  notes: z.string().max(2000),
  positions: z.array(z.string().trim().min(1).max(100)).max(30),
  isActive: z.boolean(),
};

export const branchInput = z.object({
  ...branchFields,
  address: branchFields.address.default(""),
  meetingPoint: branchFields.meetingPoint.default(""),
  notes: branchFields.notes.default(""),
  positions: branchFields.positions.default([]),
  isActive: branchFields.isActive.default(true),
});

/** Aenderung einzelner Felder - ohne Standardwerte, damit nichts ueberschrieben wird. */
export const branchPatch = z.object(branchFields).partial().extend({ id: z.string().min(1) });
