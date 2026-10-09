import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

// Kein "standalone": Die App wird ueber den eigenen Server (server.ts)
// gestartet, damit Socket.io fuer Echtzeit-Updates mitlaeuft.
const nextConfig: NextConfig = {};

export default withNextIntl(nextConfig);
