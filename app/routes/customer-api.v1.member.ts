import type { LoaderFunctionArgs } from "react-router";
import {
  getMemberSnapshot,
  publicMemberJson,
  shopDomainFromDest,
} from "../modules/members/member.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } =
    await authenticate.public.customerAccount(request);
  const snapshot = publicMemberJson(
    await getMemberSnapshot(
      shopDomainFromDest(sessionToken.dest),
      sessionToken.sub,
    ),
  );
  return cors(
    Response.json(snapshot ?? { error: "Member not found" }, {
      status: snapshot ? 200 : 404,
    }),
  );
};
