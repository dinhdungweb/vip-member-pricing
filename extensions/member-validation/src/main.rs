use shopify_function::prelude::*;

#[typegen("./schema.graphql")]
pub mod schema {
    #[query("./src/cart_validations_generate_run.graphql")]
    pub mod cart_validations_generate_run {}
}

pub mod cart_validations_generate_run;

fn main() {
    log!("Invoke a named Shopify Function export.");
    std::process::abort();
}

