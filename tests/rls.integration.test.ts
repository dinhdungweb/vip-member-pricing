import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const client = connectionString ? new pg.Client({ connectionString }) : null;
const shopA = "10000000-0000-4000-8000-000000000001";
const shopB = "20000000-0000-4000-8000-000000000002";

suite("PostgreSQL tenant RLS", () => {
  beforeAll(async () => {
    await client!.connect();
    await client!.query(
      `INSERT INTO "Shop" ("id", "domain", "updatedAt")
       VALUES ($1, 'rls-a.myshopify.com', now()),
              ($2, 'rls-b.myshopify.com', now())
       ON CONFLICT ("id") DO NOTHING`,
      [shopA, shopB],
    );
    for (const shopId of [shopA, shopB]) {
      await client!.query("BEGIN");
      await client!.query(
        "SELECT set_config('app.current_shop_id', $1, true)",
        [shopId],
      );
      await client!.query(
        `INSERT INTO "ProgramConfig" ("shopId", "updatedAt")
         VALUES ($1, now())
         ON CONFLICT ("shopId") DO NOTHING`,
        [shopId],
      );
      await client!.query("COMMIT");
    }
  });

  afterAll(async () => {
    await client?.end();
  });

  it("cannot read another shop's row", async () => {
    await client!.query("BEGIN");
    await client!.query(
      "SELECT set_config('app.current_shop_id', $1, true)",
      [shopA],
    );
    const result = await client!.query(
      `SELECT "shopId" FROM "ProgramConfig" ORDER BY "shopId"`,
    );
    await client!.query("ROLLBACK");
    expect(result.rows).toEqual([{ shopId: shopA }]);
  });

  it("cannot write another shop's row", async () => {
    await client!.query("BEGIN");
    await client!.query(
      "SELECT set_config('app.current_shop_id', $1, true)",
      [shopA],
    );
    await expect(
      client!.query(
        `UPDATE "ProgramConfig"
         SET "badgePosition" = 'bottom-right'
         WHERE "shopId" = $1`,
        [shopB],
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await client!.query("ROLLBACK");
  });
});
