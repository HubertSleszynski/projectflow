import assert from "node:assert/strict";
import { test } from "node:test";
import { projectFields, projectUpdate } from "../dist/lib/validation.js";

test("accepts trimmed project names", () => {
  const result = projectFields.safeParse({ name: "  Project Alpha  " });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.name, "Project Alpha");
});

test("rejects invalid project input", () => {
  assert.equal(projectFields.safeParse({ name: "x" }).success, false);
  assert.equal(projectFields.safeParse({ name: "a".repeat(81) }).success, false);
  assert.equal(projectFields.safeParse({ name: "Valid", isAdmin: true }).success, false);
});

test("validates updates and prevents unknown fields", () => {
  assert.equal(projectUpdate.safeParse({ status: "ARCHIVED" }).success, true);
  assert.equal(projectUpdate.safeParse({ description: "  New description  " }).success, true);
  assert.equal(projectUpdate.safeParse({ status: "HACKED" }).success, false);
  assert.equal(projectUpdate.safeParse({}).success, false);
  assert.equal(projectUpdate.safeParse({ workspaceId: "other-workspace" }).success, false);
});
