import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { decode } from "next-auth/jwt";
import { db } from "./src/lib/db";
import { allowedRooms, canJoinSchedule, type RealtimeSession } from "./src/lib/realtime";

const dev = process.env.NODE_ENV !== "production";
// Bindeadresse im Container, nicht die oeffentliche Adresse.
const bindAdresse = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

// Next bekommt hier bewusst keine Adresse: hinter dem Reverse Proxy steht die
// echte Domain im Host-Kopf. Nennt man Next "0.0.0.0", haelt es das fuer die
// eigene Adresse und schickt Weiterleitungen - etwa nach dem Abmelden - an
// https://0.0.0.0:3000 statt an die Domain.
// NEXT_DEV_WEBPACK=1 nutzen die Integrationstests (wie "next dev --webpack").
const app = next({ dev, ...(dev && process.env.NEXT_DEV_WEBPACK === "1" ? { webpack: true } : {}) });
const handle = app.getRequestHandler();

/** Wie oft offene Verbindungen ohne besonderen Anlass neu bewertet werden. */
const RECHTE_PRUEFUNG_MS = 60_000;

// Die Session steckt im NextAuth-Cookie. Hinter HTTPS heisst es "__Secure-...".
const SESSION_COOKIES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
];

type SocketSession = RealtimeSession;

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [
          part.slice(0, index),
          decodeURIComponent(part.slice(index + 1)),
        ];
      })
  );
}

/**
 * Prueft das Session-Cookie des Clients und ermittelt die Organisation.
 * Ohne gueltige Session kommt keine Socket-Verbindung zustande.
 */
async function authenticate(socket: Socket): Promise<SocketSession | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;

  const cookies = parseCookies(socket.handshake.headers.cookie);

  for (const name of SESSION_COOKIES) {
    const token = cookies[name];
    if (!token) continue;

    try {
      // salt entspricht in NextAuth v5 dem Cookie-Namen.
      const payload = await decode({ token, secret, salt: name });
      const userId = payload?.id as string | undefined;
      if (!userId) continue;

      const member = await db.organizationMember.findFirst({
        where: { userId, isActive: true, isActivated: true, organization: { deletedAt: null } },
        orderBy: { joinedAt: "asc" },
        select: { organizationId: true },
      });
      if (!member) continue;

      return { userId, orgId: member.organizationId };
    } catch {
      // Ungueltiges oder abgelaufenes Token -> naechstes Cookie probieren.
    }
  }

  return null;
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new SocketIOServer(httpServer, {
    path: "/api/ws",
    // Gleiche Herkunft wie die App - keine fremden Webseiten.
    cors: { origin: false },
  });

  const sessions = new WeakMap<Socket, SocketSession>();

  io.use(async (socket, nextFn) => {
    const session = await authenticate(socket);
    if (!session) {
      nextFn(new Error("Nicht angemeldet"));
      return;
    }
    sessions.set(socket, session);
    nextFn();
  });

  /**
   * Raeume einer Verbindung an die aktuellen Rechte angleichen. Ohne gueltige
   * Mitgliedschaft wird die Verbindung getrennt; entzogene Standorte und
   * Live-Raeume werden verlassen. Laeuft bei der Verbindung, bei jedem
   * Client-Ereignis, nach Rechteaenderungen und regelmaessig.
   */
  async function abgleichen(socket: Socket): Promise<boolean> {
    const session = sessions.get(socket);
    if (!session) {
      socket.disconnect(true);
      return false;
    }
    const allowed = await allowedRooms(session);
    if (!allowed) {
      socket.disconnect(true);
      return false;
    }
    for (const room of [...socket.rooms]) {
      if (room === socket.id) continue;
      if (room.startsWith("schedule:")) {
        if (!(await canJoinSchedule(session, room.slice("schedule:".length)))) socket.leave(room);
      } else if (!allowed.has(room)) {
        socket.leave(room);
      }
    }
    for (const room of allowed) socket.join(room);
    return true;
  }

  async function alleAbgleichen(userIds?: string[]) {
    const wanted = userIds ? new Set(userIds) : null;
    for (const socket of io.of("/").sockets.values()) {
      const session = sessions.get(socket);
      if (wanted && (!session || !wanted.has(session.userId))) continue;
      try {
        await abgleichen(socket);
      } catch (error) {
        console.error("Echtzeit-Abgleich fehlgeschlagen", error);
      }
    }
  }

  io.on("connection", (socket) => {
    const session = sessions.get(socket)!;
    // Handler zuerst registrieren, damit fruehe Client-Ereignisse nicht verloren gehen.
    void abgleichen(socket).catch((error) => console.error("Echtzeit-Abgleich fehlgeschlagen", error));

    // Frueher trat jeder Client dem Organisationsraum bei. Die Raeume vergibt
    // jetzt allein der Server; die Nachricht bleibt ohne Wirkung.
    socket.on("join:org", async () => {
      await abgleichen(socket);
    });

    socket.on("join:schedule", async (scheduleId: string) => {
      if (typeof scheduleId !== "string") return;
      if (!(await abgleichen(socket))) return;
      if (await canJoinSchedule(session, scheduleId)) socket.join(`schedule:${scheduleId}`);
    });

    socket.on("leave:schedule", (scheduleId: string) => {
      if (typeof scheduleId !== "string") return;
      socket.leave(`schedule:${scheduleId}`);
    });

    // ---- Live-mode events (forwarded to schedule room) ----
    // Nur weiterleiten, wenn der Client den Raum noch betreten darf; weiter
    // gegeben wird nur die Plan-ID, keine Personen.
    async function weiterleiten(event: string, data: unknown) {
      const scheduleId = (data as { scheduleId?: unknown } | null)?.scheduleId;
      if (typeof scheduleId !== "string") return;
      if (!(await abgleichen(socket))) return;
      if (!socket.rooms.has(`schedule:${scheduleId}`)) return;
      socket.to(`schedule:${scheduleId}`).emit(event, { scheduleId });
    }

    socket.on("live:started", (data: unknown) => weiterleiten("live:started", data));
    socket.on("live:stopped", (data: unknown) => weiterleiten("live:stopped", data));
    socket.on("live:booking", (data: unknown) => weiterleiten("live:booking", data));
  });

  const pruefung = setInterval(() => void alleAbgleichen(), RECHTE_PRUEFUNG_MS);
  pruefung.unref();

  (globalThis as Record<string, unknown>).__socketIO = io;
  (globalThis as Record<string, unknown>).__akroRefreshRealtime = alleAbgleichen;

  httpServer.listen(port, bindAdresse, () => {
    console.log(`> Ready on http://${bindAdresse}:${port}`);
  });
});
