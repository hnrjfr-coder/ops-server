const DEFAULT_BULKSMS_ENDPOINT = "https://www.bulksmsnigeria.com/api/v2/sms";

function normalizeNigerianPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  const international = digits.startsWith("0") && digits.length === 11
    ? `234${digits.slice(1)}`
    : digits;
  return /^\d{8,15}$/.test(international) ? international : null;
}

function formatAmount(amount) {
  return new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(Number(amount) || 0);
}

export async function sendPayoutApprovalSms(payoutRequest, {
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const token = String(env.BULKSMS_TOKEN || "").trim();
  const senderId = String(env.BULKSMS_SENDER_ID || "").trim();
  if (!token || !senderId) return { status: "not_configured" };

  const recipient = normalizeNigerianPhone(payoutRequest.employeePhone);
  if (!recipient) return { status: "invalid_phone" };

  const endpoint = String(env.BULKSMS_API_URL || DEFAULT_BULKSMS_ENDPOINT).trim();
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: senderId,
        to: recipient,
        body: `Hi ${String(payoutRequest.employeeName || "there").replace(/[\r\n]/g, " ").trim()}, your payout of NGN ${formatAmount(payoutRequest.amount)} has been approved and processed. Thank you.`,
        ...(env.BULKSMS_GATEWAY ? { gateway: env.BULKSMS_GATEWAY } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return { status: "failed", reason: error.name === "TimeoutError" ? "timeout" : "network_error" };
  }

  if (!response.ok) return { status: "failed", reason: "provider_rejected" };
  try {
    const result = await response.json();
    if (result?.success === false || ["error", "failed"].includes(String(result?.status || "").toLowerCase())) {
      return { status: "failed", reason: "provider_rejected" };
    }
  } catch {
    return { status: "failed", reason: "invalid_provider_response" };
  }
  return { status: "sent" };
}
