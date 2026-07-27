import "dotenv/config";
import { defineConfig } from "prisma/config";

const migrationUrl =
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL ??
  "postgresql://vip_pricing_migrate:vip_pricing@127.0.0.1:5432/vip_pricing";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrationUrl,
  },
});
