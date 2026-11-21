import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "../dist/lib/auth.js";

test("scrypt passwords hash and verify correctly", async () => {
  const secret = "correct-horse-battery-staple";
  const saved = await hashPassword(secret);
  assert.ok(saved.startsWith("scrypt:"));
  assert.equal(saved.includes(secret), false);
  assert.equal(await verifyPassword(secret, saved), true);
  assert.equal(await verifyPassword("different-password", saved), false);
  assert.equal(await verifyPassword(secret, "malformed"), false);
  assert.equal(await verifyPassword(secret, null), false);
});

test("two hashes of same password use different salts", async () => {
  const a = await hashPassword("same-long-password");
  const b = await hashPassword("same-long-password");
  assert.notEqual(a, b);
});
