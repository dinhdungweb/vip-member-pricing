import { readFile, writeFile } from "node:fs/promises";

const appUrl = process.env.SHOPIFY_APP_URL;
if (!appUrl || !/^https:\/\/[^/]+/i.test(appUrl)) {
  throw new Error(
    "SHOPIFY_APP_URL must be an HTTPS origin before deploying extensions",
  );
}

const target = new URL(
  "../extensions/member-account/src/app-config.ts",
  import.meta.url,
);
const current = await readFile(target, "utf8");
const next = current.replace(
  /export const API_BASE_URL = "[^"]+";/,
  `export const API_BASE_URL = ${JSON.stringify(appUrl.replace(/\/+$/, ""))};`,
);
await writeFile(target, next, "utf8");
