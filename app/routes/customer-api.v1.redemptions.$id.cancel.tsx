import type { ActionFunctionArgs } from "react-router";
import { authenticateCustomer } from "../modules/members/customer-auth.server";
import {
  cancelRedemption,
  RedemptionError,
} from "../modules/rewards/redemption.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shopDomain, customerId, cors } = await authenticateCustomer(request);
  if (!params.id) {
    return cors(
      Response.json({ error: "Redemption id is required" }, { status: 400 }),
    );
  }

  try {
    const redemption = await cancelRedemption({
      shopDomain,
      customerGid: customerId,
      redemptionId: params.id,
    });
    return cors(
      Response.json(
        { id: redemption.id, status: redemption.status },
        { status: redemption.status === "ISSUED" ? 202 : 200 },
      ),
    );
  } catch (error) {
    if (error instanceof RedemptionError) {
      return cors(
        Response.json({ error: error.message }, { status: error.status }),
      );
    }
    throw error;
  }
};

