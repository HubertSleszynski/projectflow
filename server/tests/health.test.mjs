import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createApp } from "../dist/app.js";

const server = createApp().listen(0, "127.0.0.1");
await once(server, "listening");

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Could not obtain the test server port");
}
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  await test("GET /api/health returns expected JSON", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, "ok");
    assert.equal(data.service, "projectflow-api");
    assert.equal(data.version, "1.1.0");
    assert.ok(!Number.isNaN(Date.parse(data.timestamp)));
  });

  await test("API responses include baseline security and cache headers", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("x-powered-by"), null);
  });

  await test("invalid JSON returns 400 (not an internal error)", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "Origin": "http://localhost:3000", "Content-Type": "application/json" },
      body: '{"broken":',
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /Invalid JSON/);
  });

  await test("large request body returns 413", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "Origin": "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ big: "A".repeat(17000) }),
    });
    assert.equal(response.status, 413);
  });

  await test("unknown API path returns JSON 404", async () => {
    const response = await fetch(`${baseUrl}/api/missing`);
    assert.equal(response.status, 404);
    const data = await response.json();
    assert.equal(data.status, "error");
  });
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
