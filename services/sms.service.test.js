import assert from "node:assert/strict";
import { test } from "node:test";
import { sendPayoutApprovalSms } from "./sms.service.js";

const payoutRequest = {
  employeeName: "Test Employee",
  employeePhone: "08012345678",
  amount: 60000,
};

test("payout approval SMS uses backend BulkSMS configuration and Nigeria phone format", async () => {
  let captured;
  const result = await sendPayoutApprovalSms(payoutRequest, {
    env: {
      BULKSMS_TOKEN: "test-token",
      BULKSMS_SENDER_ID: "OPS",
      BULKSMS_GATEWAY: "premium",
    },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, json: async () => ({ success: true }) };
    },
  });

  assert.deepEqual(result, { status: "sent" });
  assert.equal(captured.url, "https://www.bulksmsnigeria.com/api/v2/sms");
  assert.equal(captured.options.headers.Authorization, "Bearer test-token");
  assert.deepEqual(JSON.parse(captured.options.body), {
    from: "OPS",
    to: "2348012345678",
    body: "Hi Test Employee, your payout of NGN 60,000 has been approved and processed. Thank you.",
    gateway: "premium",
  });
});

test("payout approval SMS does not call the provider without required settings", async () => {
  let called = false;
  const result = await sendPayoutApprovalSms(payoutRequest, {
    env: {},
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => ({ success: true }) };
    },
  });

  assert.deepEqual(result, { status: "not_configured" });
  assert.equal(called, false);
});

test("payout approval SMS reports malformed phone numbers without calling the provider", async () => {
  let called = false;
  const result = await sendPayoutApprovalSms({ ...payoutRequest, employeePhone: "not-a-phone" }, {
    env: { BULKSMS_TOKEN: "test-token", BULKSMS_SENDER_ID: "OPS" },
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => ({ success: true }) };
    },
  });

  assert.deepEqual(result, { status: "invalid_phone" });
  assert.equal(called, false);
});

test("payout approval SMS reports provider failures without throwing", async () => {
  const result = await sendPayoutApprovalSms(payoutRequest, {
    env: { BULKSMS_TOKEN: "test-token", BULKSMS_SENDER_ID: "OPS" },
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
  });

  assert.deepEqual(result, { status: "failed", reason: "provider_rejected" });
});
