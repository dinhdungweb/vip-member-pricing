import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const connectionString =
  process.env.MAINTENANCE_DATABASE_URL ?? process.env.DIRECT_URL;

if (!connectionString) {
  throw new Error(
    "MAINTENANCE_DATABASE_URL (or DIRECT_URL) is required for the worker dispatcher",
  );
}

const globalForPrisma = globalThis as unknown as {
  vipPricingMaintenancePrisma?: PrismaClient;
};

const maintenanceDb =
  globalForPrisma.vipPricingMaintenancePrisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.vipPricingMaintenancePrisma = maintenanceDb;
}

export default maintenanceDb;
