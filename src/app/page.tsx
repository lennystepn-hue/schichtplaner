import { redirect } from "next/navigation";

/**
 * Die Startseite hat keinen eigenen Inhalt: Wer angemeldet ist, landet direkt
 * im Schichtplan; alle anderen schickt die Anmeldepruefung auf /login.
 */
export default function Home() {
  redirect("/dashboard");
}
