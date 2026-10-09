import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-8xl font-bold text-muted-foreground/40">
          404
        </h1>
        <h2 className="mt-4 text-2xl font-semibold text-foreground">
          Seite nicht gefunden
        </h2>
        <p className="mt-2 text-muted-foreground">
          Die angeforderte Seite existiert nicht oder wurde verschoben.
        </p>
        <Link
          href="/schedule/flexible"
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary/90"
        >
          Zum Dashboard
        </Link>
      </div>
    </div>
  );
}
