import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

describe("storefront asset budget", () => {
  it("keeps the app embed JavaScript below 20 KB gzip", async () => {
    const source = await readFile(
      new URL(
        "../extensions/member-storefront/assets/member-pricing.js",
        import.meta.url,
      ),
    );
    expect(gzipSync(source).byteLength).toBeLessThan(20 * 1024);
  });
});
