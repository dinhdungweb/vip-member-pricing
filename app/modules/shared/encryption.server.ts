import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

function encryptionKey(): Buffer {
  const source =
    process.env.REWARD_ENCRYPTION_KEY ?? process.env.SHOPIFY_API_SECRET;
  if (!source) {
    throw new Error(
      "REWARD_ENCRYPTION_KEY or SHOPIFY_API_SECRET is required",
    );
  }
  return createHash("sha256").update(source).digest();
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptSecret(value: string): string {
  const [ivValue, tagValue, ciphertextValue] = value.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Encrypted value is malformed");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function deterministicRewardCode(redemptionId: string): string {
  const secret =
    process.env.REWARD_CODE_SECRET ??
    process.env.REWARD_ENCRYPTION_KEY ??
    process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("REWARD_CODE_SECRET is required");
  const suffix = createHmac("sha256", secret)
    .update(redemptionId)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `VIP-${suffix}`;
}
