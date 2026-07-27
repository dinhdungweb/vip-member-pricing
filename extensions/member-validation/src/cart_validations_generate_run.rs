use super::schema;
use shopify_function::prelude::*;
use shopify_function::Result;

#[derive(Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
struct MemberState {
    enabled: bool,
    tier_rank: i32,
}

#[derive(Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
struct AccessConfig {
    enabled: bool,
    rules: Vec<AccessRule>,
}

#[derive(Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
struct AccessRule {
    product_gids: Vec<String>,
    variant_gids: Vec<String>,
    login_required: bool,
    minimum_tier_rank: Option<i32>,
    message_vi: Option<String>,
    message_en: Option<String>,
}

#[shopify_function]
fn cart_validations_generate_run(
    input: schema::cart_validations_generate_run::Input,
) -> Result<schema::CartValidationsGenerateRunResult> {
    let config: &AccessConfig = match input.validation().metafield() {
        Some(metafield) => metafield.json_value(),
        None => return Ok(empty()),
    };
    if !config.enabled {
        return Ok(empty());
    }

    let member: Option<&MemberState> = input
        .cart()
        .buyer_identity()
        .and_then(|identity| identity.customer())
        .and_then(|customer| customer.metafield())
        .map(|metafield| metafield.json_value());
    let tier_rank = member
        .filter(|state| state.enabled)
        .map(|state| state.tier_rank)
        .unwrap_or(-1);

    let mut errors = Vec::new();
    for (index, line) in input.cart().lines().iter().enumerate() {
        let variant = match &line.merchandise() {
            schema::cart_validations_generate_run::input::cart::lines::Merchandise::ProductVariant(
                variant,
            ) => variant,
            _ => continue,
        };
        for rule in &config.rules {
            let targeted = rule
                .product_gids
                .contains(&variant.product().id().to_string())
                || rule.variant_gids.contains(&variant.id().to_string());
            if !targeted {
                continue;
            }
            let blocked = (rule.login_required && tier_rank < 0)
                || rule
                    .minimum_tier_rank
                    .map(|minimum| tier_rank < minimum)
                    .unwrap_or(false);
            if blocked {
                let vi = rule
                    .message_vi
                    .as_deref()
                    .unwrap_or("Vui lòng đăng nhập hoặc nâng hạng thành viên để mua sản phẩm này.");
                let en = rule
                    .message_en
                    .as_deref()
                    .unwrap_or("Please sign in or upgrade your member tier to buy this item.");
                errors.push(schema::ValidationError {
                    message: format!("{vi} / {en}"),
                    target: format!("$.cart.lines[{index}]"),
                });
                break;
            }
        }
    }

    Ok(schema::CartValidationsGenerateRunResult {
        operations: vec![schema::Operation::ValidationAdd(
            schema::ValidationAddOperation { errors },
        )],
    })
}

fn empty() -> schema::CartValidationsGenerateRunResult {
    schema::CartValidationsGenerateRunResult { operations: vec![] }
}
