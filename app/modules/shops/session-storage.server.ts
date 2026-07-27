import { Session } from "@shopify/shopify-api";
import { SessionStorage } from "@shopify/shopify-app-session-storage";
import db from "../../db.server";

export class PrismaV7SessionStorage implements SessionStorage {
  async storeSession(session: Session): Promise<boolean> {
    const data = this.toRecord(session);
    await db.session.upsert({
      where: { id: session.id },
      update: data,
      create: data,
    });
    return true;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const record = await db.session.findUnique({ where: { id } });
    if (!record) return undefined;

    return new Session({
      id: record.id,
      shop: record.shop,
      state: record.state,
      isOnline: record.isOnline,
      scope: record.scope ?? undefined,
      expires: record.expires ?? undefined,
      accessToken: record.accessToken,
      onlineAccessInfo: record.userId
        ? {
            associated_user_scope: record.scope ?? "",
            expires_in: 0,
            associated_user: {
              id: Number(record.userId),
              first_name: record.firstName ?? "",
              last_name: record.lastName ?? "",
              email: record.email ?? "",
              account_owner: record.accountOwner,
              locale: record.locale ?? "",
              collaborator: record.collaborator ?? false,
              email_verified: record.emailVerified ?? false,
            },
          }
        : undefined,
      refreshToken: record.refreshToken ?? undefined,
      refreshTokenExpires: record.refreshTokenExpires ?? undefined,
    });
  }

  async deleteSession(id: string): Promise<boolean> {
    await db.session.deleteMany({ where: { id } });
    return true;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    await db.session.deleteMany({ where: { id: { in: ids } } });
    return true;
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const records = await db.session.findMany({ where: { shop } });
    const sessions = await Promise.all(
      records.map((record) => this.loadSession(record.id)),
    );
    return sessions.filter((session): session is Session => Boolean(session));
  }

  private toRecord(session: Session) {
    const online = session.onlineAccessInfo;
    return {
      id: session.id,
      shop: session.shop,
      state: session.state,
      isOnline: session.isOnline,
      scope: session.scope ?? null,
      expires: session.expires ?? null,
      accessToken: session.accessToken ?? "",
      userId: online?.associated_user?.id
        ? BigInt(online.associated_user.id)
        : null,
      firstName: online?.associated_user?.first_name ?? null,
      lastName: online?.associated_user?.last_name ?? null,
      email: online?.associated_user?.email ?? null,
      accountOwner: online?.associated_user?.account_owner ?? false,
      locale: online?.associated_user?.locale ?? null,
      collaborator: online?.associated_user?.collaborator ?? false,
      emailVerified: online?.associated_user?.email_verified ?? false,
      refreshToken: session.refreshToken ?? null,
      refreshTokenExpires: session.refreshTokenExpires ?? null,
    };
  }
}
