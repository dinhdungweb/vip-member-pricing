import type { Prisma } from "../../generated/prisma/client.js";
import db from "../../db.server";

export async function withTenant<T>(
  shopId: string,
  callback: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT set_config('app.current_shop_id', ${shopId}, true)
    `;
    return callback(transaction);
  });
}
