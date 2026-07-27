import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { ProgramConfig } from "../../generated/prisma/client.js";

interface PublishResult {
  discountGid: string;
  validationGid: string;
}

function userErrorMessage(errors: Array<{ message: string }> | undefined) {
  return errors?.map((error) => error.message).join("; ") ?? "";
}

export async function publishShopifyFunctions(
  admin: AdminApiContext,
  config: ProgramConfig,
  startsAt: Date,
): Promise<PublishResult> {
  const discountConfig = JSON.stringify({
    schemaVersion: 1,
    configVersion: config.configVersion + 1,
    enabled: true,
    allProducts: true,
    productGids: [],
  });
  const accessConfig = JSON.stringify({
    schemaVersion: 1,
    configVersion: config.configVersion + 1,
    enabled: true,
  });

  let discountGid = config.shopifyDiscountGid;
  if (!discountGid) {
    const response = await admin.graphql(
      `#graphql
        mutation CreateMemberDiscount($input: DiscountAutomaticAppInput!) {
          discountAutomaticAppCreate(automaticAppDiscount: $input) {
            automaticAppDiscount { discountId }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          input: {
            title: "VIP member pricing",
            functionHandle: "member-discount",
            discountClasses: ["PRODUCT"],
            startsAt: startsAt.toISOString(),
            combinesWith: {
              productDiscounts: false,
              orderDiscounts: true,
              shippingDiscounts: true,
            },
            metafields: [
              {
                namespace: "$app:vip_pricing",
                key: "discount_config",
                type: "json",
                value: discountConfig,
              },
            ],
          },
        },
      },
    );
    const body = (await response.json()) as {
      data?: {
        discountAutomaticAppCreate?: {
          automaticAppDiscount?: { discountId?: string };
          userErrors?: Array<{ message: string }>;
        };
      };
    };
    const payload = body.data?.discountAutomaticAppCreate;
    if (!payload?.automaticAppDiscount?.discountId) {
      throw new Error(
        userErrorMessage(payload?.userErrors) ||
          "Shopify did not create the automatic discount",
      );
    }
    discountGid = payload.automaticAppDiscount.discountId;
  } else {
    const response = await admin.graphql(
      `#graphql
        mutation RefreshMemberDiscount($id: ID!, $metafields: [MetafieldsSetInput!]!) {
          discountAutomaticActivate(id: $id) {
            userErrors { field message }
          }
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
          }
        }`,
      {
        variables: {
          id: discountGid,
          metafields: [
            {
              ownerId: discountGid,
              namespace: "$app:vip_pricing",
              key: "discount_config",
              type: "json",
              value: discountConfig,
            },
          ],
        },
      },
    );
    const body = (await response.json()) as {
      data?: {
        discountAutomaticActivate?: {
          userErrors?: Array<{ message: string }>;
        };
        metafieldsSet?: { userErrors?: Array<{ message: string }> };
      };
    };
    const error = [
      ...(body.data?.discountAutomaticActivate?.userErrors ?? []),
      ...(body.data?.metafieldsSet?.userErrors ?? []),
    ];
    if (error.length) throw new Error(userErrorMessage(error));
  }

  let validationGid = config.shopifyValidationGid;
  if (!validationGid) {
    const response = await admin.graphql(
      `#graphql
        mutation CreateMemberValidation($input: ValidationCreateInput!) {
          validationCreate(validation: $input) {
            validation { id }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          input: {
            title: "VIP product access",
            functionHandle: "member-validation",
            enable: true,
            blockOnFailure: true,
            metafields: [
              {
                namespace: "$app:vip_pricing",
                key: "access_config",
                type: "json",
                value: accessConfig,
              },
            ],
          },
        },
      },
    );
    const body = (await response.json()) as {
      data?: {
        validationCreate?: {
          validation?: { id?: string };
          userErrors?: Array<{ message: string }>;
        };
      };
    };
    const payload = body.data?.validationCreate;
    if (!payload?.validation?.id) {
      throw new Error(
        userErrorMessage(payload?.userErrors) ||
          "Shopify did not create the cart validation",
      );
    }
    validationGid = payload.validation.id;
  } else {
    const response = await admin.graphql(
      `#graphql
        mutation RefreshMemberValidation($id: ID!, $input: ValidationUpdateInput!) {
          validationUpdate(id: $id, validation: $input) {
            userErrors { field message }
          }
        }`,
      {
        variables: {
          id: validationGid,
          input: {
            enable: true,
            blockOnFailure: true,
            metafields: [
              {
                namespace: "$app:vip_pricing",
                key: "access_config",
                type: "json",
                value: accessConfig,
              },
            ],
          },
        },
      },
    );
    const body = (await response.json()) as {
      data?: {
        validationUpdate?: { userErrors?: Array<{ message: string }> };
      };
    };
    const error = userErrorMessage(body.data?.validationUpdate?.userErrors);
    if (error) throw new Error(error);
  }

  return { discountGid, validationGid };
}

export async function disableShopifyFunctions(
  admin: AdminApiContext,
  config: ProgramConfig,
): Promise<void> {
  if (config.shopifyDiscountGid) {
    const response = await admin.graphql(
      `#graphql
        mutation DisableMemberDiscount($id: ID!) {
          discountAutomaticDeactivate(id: $id) {
            userErrors { field message }
          }
        }`,
      { variables: { id: config.shopifyDiscountGid } },
    );
    const body = (await response.json()) as {
      data?: {
        discountAutomaticDeactivate?: {
          userErrors?: Array<{ message: string }>;
        };
      };
    };
    const error = userErrorMessage(
      body.data?.discountAutomaticDeactivate?.userErrors,
    );
    if (error) throw new Error(error);
  }
  if (config.shopifyValidationGid) {
    const response = await admin.graphql(
      `#graphql
        mutation DisableMemberValidation($id: ID!, $input: ValidationUpdateInput!) {
          validationUpdate(id: $id, validation: $input) {
            userErrors { field message }
          }
        }`,
      {
        variables: {
          id: config.shopifyValidationGid,
          input: { enable: false },
        },
      },
    );
    const body = (await response.json()) as {
      data?: {
        validationUpdate?: { userErrors?: Array<{ message: string }> };
      };
    };
    const error = userErrorMessage(body.data?.validationUpdate?.userErrors);
    if (error) throw new Error(error);
  }
}
