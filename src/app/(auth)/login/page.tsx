"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const result = await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false,
    });

    if (result?.error) {
      setError("Ungültige Anmeldedaten");
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Markenseite: der Verlauf der Dachmarke, einmal und gross. */}
      <aside className="akro-marke-verlauf akro-auf-marke hidden flex-col justify-between p-10 lg:flex">
        <Image
          src="/akro/img/akro-wortmarke.svg"
          alt="AKRO"
          width={115}
          height={30}
          priority
          className="akro-marke-hell h-[26px] w-auto"
        />
        <p className="max-w-[22ch] text-[30px] leading-[1.15] font-[550] tracking-[-0.04em] text-white">
          Einsätze planen, Zeiten erfassen, Team informieren.
        </p>
        <p className="text-[12px] text-white/70">
          AKRO GmbH · Interner Zugang
        </p>
      </aside>

      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[22rem]">
          <Image
            src="/akro/img/akro-wortmarke.svg"
            alt="AKRO"
            width={115}
            height={30}
            priority
            className="mb-8 h-[22px] w-auto lg:hidden"
          />

          <p className="akro-label">Schichtplaner</p>
          <h1 className="mt-1 mb-6 text-[28px] leading-none font-[560] tracking-[-0.03em]">
            Anmelden
          </h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-[var(--radius)] bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
              >
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Wird angemeldet ..." : "Anmelden"}
            </Button>
          </form>

          <p className="mt-6 border-t pt-4 text-[13px] leading-relaxed text-muted-foreground">
            Interner Zugang der AKRO GmbH. Einen Einladungslink erhältst du von
            deiner Administration.
          </p>
        </div>
      </main>
    </div>
  );
}
