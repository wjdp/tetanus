import { describe, expect, it } from "vitest";
import { channelFormsFrom, channelPatch, isChannelDirty } from "./channelForms";

const stored = {
  pushover: { token: "app-token", user: "user-key" },
  webhook: { url: "https://hooks.example/tetanus", secret: "s3cret" },
};

describe("channel forms", () => {
  it("round-trips stored settings per channel", () => {
    const forms = channelFormsFrom(stored);
    expect(channelPatch(forms, "pushover")).toEqual({
      pushover: stored.pushover,
    });
    expect(channelPatch(forms, "webhook")).toEqual({ webhook: stored.webhook });
  });

  it("trims typed values", () => {
    const forms = channelFormsFrom(stored);
    forms.pushover.token = " new-token ";
    expect(channelPatch(forms, "pushover")).toEqual({
      pushover: { token: "new-token", user: "user-key" },
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
    expect(channelPatch(forms, "webhook")).toEqual({ webhook: null });
  });

  it("is dirty only when the channel's patch changes", () => {
    const saved = channelFormsFrom(stored);
    const forms = channelFormsFrom(stored);
    forms.pushover.user = " user-key ";
    expect(isChannelDirty(forms, saved, "pushover")).toBe(false);

    forms.webhook.url = "https://hooks.example/other";
    expect(isChannelDirty(forms, saved, "webhook")).toBe(true);
    expect(isChannelDirty(forms, saved, "pushover")).toBe(false);
  });

  it("ignores edits to a disabled channel's fields", () => {
    const saved = channelFormsFrom({ pushover: null, webhook: null });
    const forms = channelFormsFrom({ pushover: null, webhook: null });
    forms.pushover.token = "typed";
    expect(isChannelDirty(forms, saved, "pushover")).toBe(false);
  });
});
