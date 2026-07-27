use super::schema;
use shopify_function::prelude::*;
use shopify_function::Result;

#[derive(serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
struct MemberState {
    enabled: bool,
    discount_bps: i32,
}

#[derive(serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
struct DiscountConfig {
    enabled: bool,
    product_gids: Vec<String>,
}

fn tier_discount_amount(current: f64, compare_at: Option<f64>, bps: i32) -> f64 {
    let original = compare_at
        .filter(|compare| *compare > current)
        .unwrap_or(current);
    (original * bps.clamp(0, 10_000) as f64 / 10_000.0).min(current)
}

#[shopify_function]
fn cart_lines_discounts_generate_run(
    input: schema::cart_lines_discounts_generate_run::Input,
) -> Result<schema::CartLinesDiscountsGenerateRunResult> {
    let config: DiscountConfig = match input.discount().metafield() {
        Some(metafield) => match serde_json::from_str(metafield.value()) {
            Ok(config) => config,
            Err(_) => return Ok(empty()),
        },
        None => return Ok(empty()),
    };
    if !config.enabled {
        return Ok(empty());
    }

    let member: MemberState = match input
        .cart()
        .buyer_identity()
        .and_then(|identity| identity.customer())
        .and_then(|customer| customer.metafield())
    {
        Some(metafield) => match serde_json::from_str(metafield.value()) {
            Ok(member) => member,
            Err(_) => return Ok(empty()),
        },
        None => return Ok(empty()),
    };
    let discount_bps = member.discount_bps.clamp(0, 10_000);
    if !member.enabled || discount_bps == 0 {
        return Ok(empty());
    }

    let mut candidates = Vec::new();
    for line in input.cart().lines() {
        let variant = match &line.merchandise() {
            schema::cart_lines_discounts_generate_run::input::cart::lines::Merchandise::ProductVariant(
                variant,
            ) => variant,
            _ => continue,
        };
        if !config.product_gids.is_empty()
            && !config.product_gids.contains(&variant.product().id().to_string())
        {
            continue;
        }

        let current = line.cost().amount_per_quantity().amount().0;
        let compare_at = line
            .cost()
            .compare_at_amount_per_quantity()
            .map(|money| money.amount().0)
            .filter(|compare_at| *compare_at > current);
        let amount = tier_discount_amount(current, compare_at, discount_bps);
        if amount <= 0.0 {
            continue;
        }

        candidates.push(schema::ProductDiscountCandidate {
            value: schema::ProductDiscountCandidateValue::FixedAmount(
                schema::ProductDiscountCandidateFixedAmount {
                    amount: Decimal(amount),
                    applies_to_each_item: Some(true),
                },
            ),
            targets: vec![schema::ProductDiscountCandidateTarget::CartLine(
                schema::CartLineTarget {
                    id: line.id().to_string(),
                    quantity: None,
                },
            )],
            message: Some(format!("{}% MEMBER", discount_bps as f64 / 100.0)),
            associated_discount_code: None,
            prerequisites: None,
        });
    }

    if candidates.is_empty() {
        return Ok(empty());
    }
    Ok(schema::CartLinesDiscountsGenerateRunResult {
        operations: vec![schema::CartOperation::ProductDiscountsAdd(
            schema::ProductDiscountsAddOperation {
                selection_strategy: schema::ProductDiscountSelectionStrategy::All,
                candidates,
            },
        )],
    })
}

fn empty() -> schema::CartLinesDiscountsGenerateRunResult {
    schema::CartLinesDiscountsGenerateRunResult { operations: vec![] }
}

#[cfg(test)]
mod tests {
    use super::tier_discount_amount;

    #[test]
    fn stacks_six_percent_from_compare_at_price() {
        assert_eq!(tier_discount_amount(900_000.0, Some(1_000_000.0), 600), 60_000.0);
    }

    #[test]
    fn caps_discount_at_current_price() {
        assert_eq!(tier_discount_amount(10.0, Some(100.0), 10_000), 10.0);
    }
}
