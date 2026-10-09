"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
export default function Activate() {
  const [status, setStatus] = useState(""), [done, setDone] = useState(false), [busy, setBusy] = useState(false);
  return <main className="min-h-screen grid place-items-center p-4"><Card className="w-full max-w-md p-6"><h1>Zugang aktivieren</h1>{done ? <Link href="/login">Aktiviert. Jetzt anmelden</Link> : <form className="space-y-4" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setStatus("");
    const password = String(new FormData(e.currentTarget).get("password"));
    try { const res = await fetch("/api/auth/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: new URLSearchParams(location.search).get("token"), password }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error); setDone(true); } catch (error) { setStatus(error instanceof Error ? error.message : "Aktivierung fehlgeschlagen."); } finally { setBusy(false); }
  }}><label className="block">Passwort<Input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></label><p className="text-sm text-muted-foreground">Mindestens zwölf Zeichen, Groß- und Kleinbuchstaben und eine Zahl.</p><p role="alert">{status}</p><Button disabled={busy}>Zugang aktivieren</Button></form>}</Card></main>;
}
