import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  type Fetch,
  type OutgoingNotification,
  PUSHOVER_URL,
  sendPushover,
  sendToChannel,
  sendWebhook,
} from "~~/server/services/alerts/channels";

const notification: OutgoingNotification = {
  rule: "pool-degraded",
  severity: "alert",
  subject: "mars · tank",
  subjectType: "pool",
  subjectId: 5,
  host: "mars",
  title: "Pool degraded",
  message: "mars · tank: DEGRADED (was ONLINE)",
  at: new Date("2026-09-01T10:00:00Z"),
  dedupeKey: "pool-degraded:pool:5:DEGRADED:7",
};

function fakeFetch(response: () => Response | Promise<Response>) {
  return vi.fn<Fetch>(async () => response());
}

function lastCall(fetchMock: ReturnType<typeof fakeFetch>) {
  const [url, init] = fetchMock.mock.lastCall ?? [];
  return { url, init: init as RequestInit };
}

describe("sendPushover", () => {
  const config = { token: "app", user: "me" };

  it("posts the rule label and subject text as an alert", async () => {
    const fetchMock = fakeFetch(() => Response.json({ status: 1 }));
    expect(await sendPushover(config, notification, fetchMock)).toEqual({
      ok: true,
      error: null,
    });
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe(PUSHOVER_URL);
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      token: "app",
      user: "me",
      title: "Pool degraded",
      message: "mars · tank: DEGRADED (was ONLINE)",
      priority: "1",
      timestamp: String(Date.parse("2026-09-01T10:00:00Z") / 1000),
    });
  });

  it("sends recoveries at normal priority", async () => {
    const fetchMock = fakeFetch(() => Response.json({ status: 1 }));
    await sendPushover(
      config,
      { ...notification, severity: "recovery" },
      fetchMock,
    );
    expect(
      (lastCall(fetchMock).init.body as URLSearchParams).get("priority"),
    ).toBe("0");
  });

  it("reports the HTTP status and body of a rejection", async () => {
    const fetchMock = fakeFetch(
      () => new Response('{"errors":["user key is invalid"]}', { status: 400 }),
    );
    expect(await sendPushover(config, notification, fetchMock)).toEqual({
      ok: false,
      error: 'HTTP 400: {"errors":["user key is invalid"]}',
    });
  });

  it("reports a network failure", async () => {
    const fetchMock = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await sendPushover(config, notification, fetchMock)).toEqual({
      ok: false,
      error: "fetch failed",
    });
  });
});

describe("sendWebhook", () => {
  const url = "https://hooks.example/tetanus";

  it("posts the alert as JSON", async () => {
    const fetchMock = fakeFetch(() => new Response(null, { status: 204 }));
    expect((await sendWebhook({ url }, notification, fetchMock)).ok).toBe(true);
    const { url: sentTo, init } = lastCall(fetchMock);
    expect(sentTo).toBe(url);
    expect(JSON.parse(init.body as string)).toEqual({
      ...notification,
      at: "2026-09-01T10:00:00.000Z",
    });
    expect(init.headers).toEqual({ "content-type": "application/json" });
  });

  it("signs the body with the secret", async () => {
    const fetchMock = fakeFetch(() => new Response(null, { status: 200 }));
    await sendWebhook({ url, secret: "s3cret" }, notification, fetchMock);
    const { init } = lastCall(fetchMock);
    const expected = createHmac("sha256", "s3cret")
      .update(init.body as string)
      .digest("hex");
    expect(
      (init.headers as Record<string, string>)["X-Tetanus-Signature"],
    ).toBe(`sha256=${expected}`);
  });
});

describe("sendToChannel", () => {
  it("fails a channel that is not configured", async () => {
    const fetchMock = fakeFetch(() => new Response(null));
    expect(
      await sendToChannel(
        "webhook",
        { pushover: null, webhook: null },
        notification,
        fetchMock,
      ),
    ).toEqual({ ok: false, error: "webhook is not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
