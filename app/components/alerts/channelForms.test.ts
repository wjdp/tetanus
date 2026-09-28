import { describe, expect, it } from "vitest";
import { SECRET_MASK } from "#shared/schemas/settings";
import { channelFormsFrom, notificationsPatch } from "./channelForms";

const stored = {
  pushover: { token: SECRET_MASK, user: SECRET_MASK },
  webhook: { url: "https://hooks.example/tetanus", secret: SECRET_MASK },
};

describe("channel forms", () => {
  it("sends masked secrets back unchanged", () => {
    expect(notificationsPatch(channelFormsFrom(stored))).toEqual(stored);
  });

  it("sends a newly typed secret in place of the mask", () => {
    const forms = channelFormsFrom(stored);
    forms.pushover.token = " new-token ";
    forms.webhook.secret = "new-secret";

    expect(notificationsPatch(forms)).toEqual({
      pushover: { token: "new-token", user: SECRET_MASK },
      webhook: { url: "https://hooks.example/tetanus", secret: "new-secret" },
    });
  });

  it("starts unconfigured channels disabled and blank", () => {
    expect(channelFormsFrom({ pushover: null, webhook: null })).toEqual({
      pushover: { enabled: false, token: "", user: "" },
      webhook: { enabled: false, url: "", secret: "" },
    });
  });

  it("leaves the webhook secret blank when none is stored", () => {
    const forms = channelFormsFrom({
      pushover: null,
      webhook: { url: "https://hooks.example/tetanus" },
    });
    expect(forms.webhook.secret).toBe("");
  });

  it("sends null for a disabled channel", () => {
    const forms = channelFormsFrom(stored);
    forms.webhook.enabled = false;
    expect(notificationsPatch(forms)).toEqual({
      pushover: stored.pushover,
      webhook: null,
    });
  });
});
