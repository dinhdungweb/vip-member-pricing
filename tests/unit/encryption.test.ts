import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  deterministicRewardCode,
  encryptSecret,
} from "../../app/modules/shared/encryption.server";

const previousEncryptionKey = process.env.REWARD_ENCRYPTION_KEY;
const previousCodeSecret = process.env.REWARD_CODE_SECRET;

beforeEach(() => {
  process.env.REWARD_ENCRYPTION_KEY = "test-encryption-key";
  process.env.REWARD_CODE_SECRET = "test-code-secret";
});

afterEach(() => {
  process.env.REWARD_ENCRYPTION_KEY = previousEncryptionKey;
  process.env.REWARD_CODE_SECRET = previousCodeSecret;
});

describe("reward secrets", () => {
  it("encrypts authenticated ciphertext and decrypts it", () => {
    const first = encryptSecret("VIP-ABC");
    const second = encryptSecret("VIP-ABC");
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe("VIP-ABC");
  });

  it("generates an idempotent code for a redemption", () => {
    expect(deterministicRewardCode("redemption-1")).toBe(
      deterministicRewardCode("redemption-1"),
    );
    expect(deterministicRewardCode("redemption-1")).not.toBe(
      deterministicRewardCode("redemption-2"),
    );
  });
});
