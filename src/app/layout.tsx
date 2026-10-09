import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AKRO Schichtplaner",
    template: "%s | AKRO Schichtplaner",
  },
  description: "Dienst- und Schichtplanung der AKRO GmbH",
  icons: { icon: "/akro/img/favicon.svg" },
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  openGraph: {
    title: "AKRO Schichtplaner",
    description: "Dienst- und Schichtplanung der AKRO GmbH",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // data-brand wie im AKRO-Designsystem: die App laeuft unter der
    // Dachmarke und damit in AKRO-Blau.
    <html lang="de" data-brand="group" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
