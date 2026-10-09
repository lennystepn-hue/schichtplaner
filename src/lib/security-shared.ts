import { z } from "zod";

// Ohne Server-Abhaengigkeiten, damit auch Client-Komponenten es importieren koennen.

export const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_HINT =
  "Mindestens 12 Zeichen, mit Gross- und Kleinbuchstaben sowie einer Zahl";

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein`)
  .max(128, "Passwort ist zu lang")
  .regex(/[a-z]/, "Passwort braucht mindestens einen Kleinbuchstaben")
  .regex(/[A-Z]/, "Passwort braucht mindestens einen Grossbuchstaben")
  .regex(/[0-9]/, "Passwort braucht mindestens eine Zahl");
