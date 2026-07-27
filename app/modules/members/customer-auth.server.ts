import { authenticate } from "../../shopify.server";
import { customerGid, shopDomainFromDest } from "./member.server";

export async function authenticateCustomer(request: Request) {
  const { sessionToken, cors } =
    await authenticate.public.customerAccount(request);
  if (!sessionToken.sub) {
    throw cors(
      Response.json({ error: "Customer identity is missing" }, { status: 401 }),
    );
  }
  return {
    shopDomain: shopDomainFromDest(sessionToken.dest),
    customerId: customerGid(sessionToken.sub),
    cors,
  };
}
