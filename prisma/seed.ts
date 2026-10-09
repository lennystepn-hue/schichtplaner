import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  console.log("Seeding database...");

  // --- Organization ---
  const org = await db.organization.create({
    data: {
      name: "Demo GmbH",
      address: "Musterstraße 42, 80331 München",
      nameFormat: "LASTNAME_FIRSTNAME",
    },
  });
  console.log("  Created organization:", org.name);

  // --- Kunde und Einsatzort (Demodaten) ---
  const customer = await db.customer.create({
    data: { organizationId: org.id, name: "Musterkunde GmbH", notes: "Demodaten" },
  });
  const branch = await db.branch.create({
    data: { organizationId: org.id, customerId: customer.id, name: "Musterobjekt", address: "Musterstraße 1, 80331 München", meetingPoint: "Haupteingang" },
  });
  console.log("  Created customer and location");

  // --- Users ---
  const passwordHash = await bcrypt.hash("password123", 12);

  const users = await Promise.all([
    // Admin
    db.user.create({
      data: {
        email: "admin@demo.de",
        passwordHash,
        firstName: "Anna",
        lastName: "Weber",
        phone: "+49 151 12345678",
        locale: "de",
      },
    }),
    // Managers
    db.user.create({
      data: {
        email: "markus.mueller@demo.de",
        passwordHash,
        firstName: "Markus",
        lastName: "Müller",
        phone: "+49 151 22345678",
        locale: "de",
      },
    }),
    db.user.create({
      data: {
        email: "sabine.schmidt@demo.de",
        passwordHash,
        firstName: "Sabine",
        lastName: "Schmidt",
        phone: "+49 151 32345678",
        locale: "de",
      },
    }),
    // Employees
    db.user.create({
      data: {
        email: "thomas.bauer@demo.de",
        passwordHash,
        firstName: "Thomas",
        lastName: "Bauer",
        locale: "de",
      },
    }),
    db.user.create({
      data: {
        email: "lisa.fischer@demo.de",
        passwordHash,
        firstName: "Lisa",
        lastName: "Fischer",
        locale: "de",
      },
    }),
    db.user.create({
      data: {
        email: "stefan.wagner@demo.de",
        passwordHash,
        firstName: "Stefan",
        lastName: "Wagner",
        locale: "de",
      },
    }),
    db.user.create({
      data: {
        email: "julia.hoffmann@demo.de",
        passwordHash,
        firstName: "Julia",
        lastName: "Hoffmann",
        locale: "de",
      },
    }),
    db.user.create({
      data: {
        email: "daniel.koch@demo.de",
        passwordHash,
        firstName: "Daniel",
        lastName: "Koch",
        locale: "de",
      },
    }),
    db.user.create({
      data: {
        email: "nina.schulz@demo.de",
        passwordHash,
        firstName: "Nina",
        lastName: "Schulz",
        locale: "de",
      },
    }),
    db.user.create({
      data: {
        email: "max.braun@demo.de",
        passwordHash,
        firstName: "Max",
        lastName: "Braun",
        locale: "de",
      },
    }),
    db.user.create({
      data: {
        email: "sarah.richter@demo.de",
        passwordHash,
        firstName: "Sarah",
        lastName: "Richter",
        locale: "de",
      },
    }),
  ]);

  const [admin, manager1, manager2, ...employees] = users;
  console.log(`  Created ${users.length} users`);

  // --- Organization Members ---
  await db.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: admin.id,
      role: "OWNER",
      isActive: true,
      isActivated: true,
    },
  });
  const manager1Member = await db.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: manager1.id,
      role: "MANAGER",
      isActive: true,
      isActivated: true,
    },
  });
  await db.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: manager2.id,
      role: "MANAGER",
      isActive: true,
      isActivated: true,
    },
  });
  const employeeMembers = [];
  for (const emp of employees) {
    employeeMembers.push(await db.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: emp.id,
        role: "EMPLOYEE",
        isActive: true,
        isActivated: true,
      },
    }));
  }
  console.log("  Created organization memberships");

  // --- Freigaben (Demodaten): Manager 1 plant das Musterobjekt und vier Personen ---
  await db.branchAccess.create({
    data: { organizationId: org.id, memberId: manager1Member.id, branchId: branch.id, rights: ["VIEW_SCHEDULE", "EDIT_SHIFTS", "HANDLE_REQUESTS", "REQUEST_SHIFTS"] },
  });
  for (const member of employeeMembers.slice(0, 4)) {
    await db.staffAssignment.create({
      data: { organizationId: org.id, managerMemberId: manager1Member.id, employeeMemberId: member.id, rights: ["ASSIGN_SHIFTS", "VIEW_PROFILE"] },
    });
  }
  for (const member of employeeMembers) {
    await db.branchAccess.create({ data: { organizationId: org.id, memberId: member.id, branchId: branch.id, rights: ["REQUEST_SHIFTS"] } });
  }
  console.log("  Created demo grants");

  // --- Divisions ---
  const divKasse = await db.division.create({
    data: {
      organizationId: org.id,
      title: "Kasse",
      description: "Kassenbereich und Kundenservice",
      color: "#6366f1",
    },
  });
  const divLager = await db.division.create({
    data: {
      organizationId: org.id,
      title: "Lager",
      description: "Wareneingang, Lagerung und Kommissionierung",
      color: "#f59e0b",
    },
  });
  const divService = await db.division.create({
    data: {
      organizationId: org.id,
      title: "Service",
      description: "Beratung und Kundenbetreuung",
      color: "#10b981",
    },
  });
  console.log("  Created 3 divisions");

  // --- Division Members ---
  // Manager1 in Kasse + Service, Manager2 in Lager + Service
  await db.divisionMember.createMany({
    data: [
      { divisionId: divKasse.id, userId: manager1.id },
      { divisionId: divService.id, userId: manager1.id },
      { divisionId: divLager.id, userId: manager2.id },
      { divisionId: divService.id, userId: manager2.id },
      // Employees spread across divisions
      { divisionId: divKasse.id, userId: employees[0].id },
      { divisionId: divKasse.id, userId: employees[1].id },
      { divisionId: divKasse.id, userId: employees[2].id },
      { divisionId: divLager.id, userId: employees[3].id },
      { divisionId: divLager.id, userId: employees[4].id },
      { divisionId: divLager.id, userId: employees[5].id },
      { divisionId: divService.id, userId: employees[6].id },
      { divisionId: divService.id, userId: employees[7].id },
      // Some employees in multiple divisions
      { divisionId: divService.id, userId: employees[0].id },
      { divisionId: divKasse.id, userId: employees[7].id },
    ],
  });
  console.log("  Created division memberships");

  // --- Time Categories ---
  const timeCatNormal = await db.timeCategory.create({
    data: { organizationId: org.id, name: "Normal", enabled: true },
  });
  await db.timeCategory.create({
    data: { organizationId: org.id, name: "Überstunden", enabled: true },
  });
  await db.timeCategory.create({
    data: { organizationId: org.id, name: "Nachtarbeit", enabled: true },
  });
  console.log("  Created 3 time categories");

  // --- Absence Categories ---
  const absUrlaub = await db.absenceCategory.create({
    data: {
      organizationId: org.id,
      name: "Urlaub",
      color: "#22c55e",
      isPaid: true,
    },
  });
  const absKrank = await db.absenceCategory.create({
    data: {
      organizationId: org.id,
      name: "Krank",
      color: "#ef4444",
      isPaid: true,
    },
  });
  await db.absenceCategory.create({
    data: {
      organizationId: org.id,
      name: "Fortbildung",
      color: "#3b82f6",
      isPaid: true,
    },
  });
  console.log("  Created 3 absence categories");

  // --- Schedule (current week) ---
  const now = new Date();
  // Calculate ISO week number
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const daysSinceStart = Math.floor(
    (now.getTime() - startOfYear.getTime()) / 86400000
  );
  const weekNumber = Math.ceil((daysSinceStart + startOfYear.getDay() + 1) / 7);

  const schedule = await db.schedule.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      weekNumber,
      year: now.getFullYear(),
      isPublic: true,
      showTitle: true,
      showPauses: true,
    },
  });
  console.log(`  Created schedule for KW${weekNumber}/${now.getFullYear()}`);

  // --- Shifts ---
  const shiftTemplates = [
    // Monday
    { dayOfWeek: 1, shiftFrom: "06:00", shiftTo: "14:00", divisionId: divKasse.id, maxEmployees: 2, title: "Frühschicht" },
    { dayOfWeek: 1, shiftFrom: "14:00", shiftTo: "22:00", divisionId: divKasse.id, maxEmployees: 2, title: "Spätschicht" },
    { dayOfWeek: 1, shiftFrom: "08:00", shiftTo: "16:00", divisionId: divLager.id, maxEmployees: 2, title: "Tagschicht" },
    // Tuesday
    { dayOfWeek: 2, shiftFrom: "06:00", shiftTo: "14:00", divisionId: divKasse.id, maxEmployees: 2, title: "Frühschicht" },
    { dayOfWeek: 2, shiftFrom: "14:00", shiftTo: "22:00", divisionId: divService.id, maxEmployees: 2, title: "Spätschicht" },
    // Wednesday
    { dayOfWeek: 3, shiftFrom: "06:00", shiftTo: "14:00", divisionId: divKasse.id, maxEmployees: 2, title: "Frühschicht" },
    { dayOfWeek: 3, shiftFrom: "08:00", shiftTo: "16:00", divisionId: divLager.id, maxEmployees: 3, title: "Tagschicht" },
    { dayOfWeek: 3, shiftFrom: "14:00", shiftTo: "22:00", divisionId: divService.id, maxEmployees: 2, title: "Spätschicht" },
    // Thursday
    { dayOfWeek: 4, shiftFrom: "06:00", shiftTo: "14:00", divisionId: divKasse.id, maxEmployees: 2, title: "Frühschicht" },
    { dayOfWeek: 4, shiftFrom: "14:00", shiftTo: "22:00", divisionId: divKasse.id, maxEmployees: 2, title: "Spätschicht" },
    // Friday
    { dayOfWeek: 5, shiftFrom: "06:00", shiftTo: "14:00", divisionId: divService.id, maxEmployees: 2, title: "Frühschicht" },
    { dayOfWeek: 5, shiftFrom: "08:00", shiftTo: "16:00", divisionId: divLager.id, maxEmployees: 2, title: "Tagschicht" },
    { dayOfWeek: 5, shiftFrom: "14:00", shiftTo: "22:00", divisionId: divKasse.id, maxEmployees: 2, title: "Spätschicht" },
    // Saturday
    { dayOfWeek: 6, shiftFrom: "08:00", shiftTo: "14:00", divisionId: divKasse.id, maxEmployees: 1, title: "Samstagsschicht" },
  ];

  const shifts = await Promise.all(
    shiftTemplates.map((t) =>
      db.shift.create({
        data: {
          scheduleId: schedule.id,
          divisionId: t.divisionId,
          dayOfWeek: t.dayOfWeek,
          shiftFrom: t.shiftFrom,
          shiftTo: t.shiftTo,
          maxEmployees: t.maxEmployees,
          title: t.title,
          pauseOption: "PER_HOUR",
          pauseValue: 0,
        },
      })
    )
  );
  console.log(`  Created ${shifts.length} shifts`);

  // --- Bookings ---
  const bookingPairs = [
    { shiftIdx: 0, userIdx: 0 }, // Mon Frühschicht - Thomas
    { shiftIdx: 0, userIdx: 1 }, // Mon Frühschicht - Lisa
    { shiftIdx: 1, userIdx: 2 }, // Mon Spätschicht - Stefan
    { shiftIdx: 2, userIdx: 3 }, // Mon Lager - Julia
    { shiftIdx: 3, userIdx: 0 }, // Tue Frühschicht - Thomas
    { shiftIdx: 4, userIdx: 6 }, // Tue Spätschicht Service - Sarah
    { shiftIdx: 5, userIdx: 1 }, // Wed Frühschicht - Lisa
    { shiftIdx: 6, userIdx: 4 }, // Wed Lager - Daniel
  ];

  for (const { shiftIdx, userIdx } of bookingPairs) {
    await db.booking.create({
      data: {
        shiftId: shifts[shiftIdx].id,
        userId: employees[userIdx].id,
        bookedBy: admin.id,
      },
    });
  }
  console.log(`  Created ${bookingPairs.length} bookings`);

  // --- Sample Absences ---
  const nextWeekStart = new Date(now);
  nextWeekStart.setDate(now.getDate() + (8 - now.getDay()));

  await db.absence.create({
    data: {
      userId: employees[5].id,
      categoryId: absUrlaub.id,
      dateFrom: nextWeekStart,
      dateTo: new Date(nextWeekStart.getTime() + 4 * 86400000),
      status: "APPROVED",
      note: "Familienurlaub",
    },
  });
  await db.absence.create({
    data: {
      userId: employees[2].id,
      categoryId: absKrank.id,
      dateFrom: now,
      dateTo: new Date(now.getTime() + 2 * 86400000),
      status: "APPROVED",
    },
  });
  console.log("  Created 2 sample absences");

  // --- Time Settings ---
  await db.timeSettings.create({
    data: {
      organizationId: org.id,
      trackingOptions: "MANUAL,WATCH",
      watchAutoStop: false,
      warningsEnabled: true,
      warningsMaxHours: 10,
      whoCanUse: "ALL",
      useCategories: true,
    },
  });
  console.log("  Created time settings");

  // --- Sample Time Records ---
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  await db.timeRecord.create({
    data: {
      organizationId: org.id,
      userId: employees[0].id,
      date: yesterday,
      timeFrom: "06:00",
      timeTo: "14:00",
      type: "MANUAL",
      categoryId: timeCatNormal.id,
    },
  });
  await db.timeRecord.create({
    data: {
      organizationId: org.id,
      userId: employees[1].id,
      date: yesterday,
      timeFrom: "14:00",
      timeTo: "22:00",
      type: "MANUAL",
      categoryId: timeCatNormal.id,
    },
  });
  console.log("  Created 2 sample time records");

  // --- OrgSettings ---
  await db.orgSettings.create({
    data: {
      organizationId: org.id,
      aiEnabled: true,
      aiAutoPlanner: true,
      aiAnomalyDetection: true,
      aiChatEnabled: true,
      aiForecast: true,
      aiSmartBriefing: true,
      smsEnabled: false,
    },
  });
  console.log("  Created org settings");

  // --- Briefing ---
  await db.briefing.create({
    data: {
      scheduleId: schedule.id,
      text: `Willkommen zur KW${weekNumber}! Bitte beachtet die neuen Pausenzeiten. Bei Fragen wendet euch an Markus oder Sabine.`,
    },
  });
  console.log("  Created schedule briefing");

  console.log("\nSeeding complete!");
  console.log("Login: admin@demo.de / password123");
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
