import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <header className={styles.hero}>
          <span className={styles.brand}>VIP MEMBER PRICING</span>
          <h1 className={styles.heading}>
            Member pricing that rewards loyalty.
          </h1>
          <p className={styles.text}>
            Create VIP tiers, preferred pricing, gated product access, and point
            rewards directly in Shopify Admin.
          </p>
        </header>
        <div className={styles.panel}>
          <div>
            <span className={styles.step}>Connect your store</span>
            <h2>Open the admin app</h2>
            <p>
              Enter your <strong>.myshopify.com</strong> domain to continue.
            </p>
          </div>
          {showForm && (
            <Form className={styles.form} method="post" action="/auth/login">
              <label className={styles.label}>
                <span>Store domain</span>
                <input
                  className={styles.input}
                  type="text"
                  name="shop"
                  placeholder="your-store.myshopify.com"
                  autoComplete="url"
                />
              </label>
              <button className={styles.button} type="submit">
                Connect Shopify
              </button>
            </Form>
          )}
        </div>
        <ul className={styles.list}>
          <li>
            <span>01</span>
            <strong>Clear tiering</strong>
            <p>Automatically assign tiers from net spend.</p>
          </li>
          <li>
            <span>02</span>
            <strong>Controlled benefits</strong>
            <p>Limit pricing and products by membership tier.</p>
          </li>
          <li>
            <span>03</span>
            <strong>Transparent operations</strong>
            <p>Track points, benefits, and publication status.</p>
          </li>
        </ul>
      </div>
    </div>
  );
}
