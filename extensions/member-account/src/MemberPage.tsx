import "@shopify/ui-extensions/preact";
import type {} from "@shopify/ui-extensions/customer-account.page.render";
import { useApi } from "@shopify/ui-extensions/customer-account/preact";
import { render } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { API_BASE_URL } from "./app-config";

type Member = {
  tier: { name: string; discountBps: number } | null;
  netSpendMinor: string;
  pointsBalance: string;
  nextTier: {
    name: string;
    remainingSpendMinor: string;
  } | null;
};

type Reward = {
  id: string;
  name: string;
  pointsCost: string;
  affordable?: boolean;
  tierEligible?: boolean;
};

type LedgerEntry = {
  id: string;
  type: string;
  delta: string;
  occurredAt: string;
};

type Redemption = {
  id: string;
  rewardName: string;
  status: string;
  code: string | null;
  expiresAt: string | null;
};

async function appRequest(
  path: string,
  getToken: () => Promise<string>,
  init?: RequestInit,
) {
  const token = await getToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

function MemberPage() {
  const { sessionToken, toast } = useApi<"customer-account.page.render">();
  const [member, setMember] = useState<Member | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const redeeming = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [memberData, rewardsData, ledgerData, redemptionData] =
        await Promise.all([
          appRequest("/customer-api/v1/member", () => sessionToken.get()),
          appRequest("/customer-api/v1/rewards", () => sessionToken.get()),
          appRequest("/customer-api/v1/ledger?limit=20", () =>
            sessionToken.get(),
          ),
          appRequest("/customer-api/v1/redemptions", () => sessionToken.get()),
        ]);
      setMember(memberData);
      setRewards(rewardsData.rewards ?? rewardsData.items ?? []);
      setLedger(ledgerData.entries ?? ledgerData.items ?? []);
      setRedemptions(redemptionData.items ?? []);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load membership",
      );
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  const cancelReward = async (redemptionId: string) => {
    setError(null);
    try {
      await appRequest(
        `/customer-api/v1/redemptions/${redemptionId}/cancel`,
        () => sessionToken.get(),
        { method: "POST" },
      );
      toast.show("Reward cancellation is being processed");
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to cancel reward",
      );
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const redeem = async (rewardId: string) => {
    if (redeeming.current.has(rewardId)) return;
    redeeming.current.add(rewardId);
    setRedeemingId(rewardId);
    setError(null);
    try {
      await appRequest(
        "/customer-api/v1/redemptions",
        () => sessionToken.get(),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({ rewardId }),
        },
      );
      toast.show("Reward is being issued");
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to redeem reward",
      );
    } finally {
      redeeming.current.delete(rewardId);
      setRedeemingId(null);
    }
  };

  return (
    <s-page heading="VIP Member">
      {error && <s-banner tone="critical">{error}</s-banner>}
      {loading ? (
        <s-spinner accessibilityLabel="Loading membership" />
      ) : !member ? (
        <s-banner tone="info">
          Your membership starts after your first eligible paid order.
        </s-banner>
      ) : (
        <s-stack direction="block" gap="base">
          <s-section heading="Membership">
            <s-stack direction="block" gap="small">
              <s-badge tone="auto">{member.tier?.name ?? "Member"}</s-badge>
              <s-text>
                Member discount:{" "}
                {((member.tier?.discountBps ?? 0) / 100).toFixed(2)}%
              </s-text>
              <s-text>Points: {member.pointsBalance}</s-text>
              <s-text>Eligible spend: {member.netSpendMinor}</s-text>
              {member.nextTier && (
                <s-text>
                  {member.nextTier.remainingSpendMinor} to{" "}
                  {member.nextTier.name}
                </s-text>
              )}
            </s-stack>
          </s-section>

          <s-section heading="Rewards">
            <s-stack direction="block" gap="small">
              {rewards.length === 0 && <s-text>No rewards available.</s-text>}
              {rewards.map((reward) => (
                <s-stack key={reward.id} direction="inline" gap="base">
                  <s-text>
                    {reward.name} - {reward.pointsCost} points
                  </s-text>
                  <s-button
                    disabled={
                      redeemingId === reward.id ||
                      reward.affordable === false ||
                      reward.tierEligible === false
                    }
                    onClick={() => void redeem(reward.id)}
                  >
                    Redeem
                  </s-button>
                </s-stack>
              ))}
            </s-stack>
          </s-section>

          <s-section heading="Issued rewards">
            <s-stack direction="block" gap="small">
              {redemptions.length === 0 && (
                <s-text>No issued rewards yet.</s-text>
              )}
              {redemptions.map((redemption) => (
                <s-stack key={redemption.id} direction="inline" gap="base">
                  <s-text>
                    {redemption.rewardName}:{" "}
                    {redemption.code ?? redemption.status}
                    {redemption.expiresAt
                      ? ` (expires ${new Date(redemption.expiresAt).toLocaleDateString()})`
                      : ""}
                  </s-text>
                  {(redemption.status === "ISSUED" ||
                    redemption.status === "PENDING") && (
                    <s-button
                      onClick={() => void cancelReward(redemption.id)}
                    >
                      Cancel
                    </s-button>
                  )}
                </s-stack>
              ))}
            </s-stack>
          </s-section>

          <s-section heading="Points history">
            <s-stack direction="block" gap="small">
              {ledger.length === 0 && <s-text>No points activity yet.</s-text>}
              {ledger.map((entry) => (
                <s-text key={entry.id}>
                  {entry.type}: {entry.delta} (
                  {new Date(entry.occurredAt).toLocaleDateString()})
                </s-text>
              ))}
            </s-stack>
          </s-section>

        </s-stack>
      )}
    </s-page>
  );
}

export default async () => {
  render(<MemberPage />, document.body);
};
