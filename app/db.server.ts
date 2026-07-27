import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://vip_pricing:vip_pricing@127.0.0.1:6432/vip_pricing";

const globalForPrisma = globalThis as unknown as {
  vipPricingPrisma?: PrismaClient;
};

const prisma =
  globalForPrisma.vipPricingPrisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.vipPricingPrisma = prisma;
}

export default prisma;
