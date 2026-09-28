// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { emitTask, FakeEventSource } from "~~/test/fakeEventSource";
import AppTaskIndicator from "./AppTaskIndicator.vue";

registerEndpoint("/api/tasks", () => []);

beforeEach(() => {
  FakeEventSource.install();
});

const indicator = '[data-testid="task-indicator"]';

describe("AppTaskIndicator", () => {
  it("shows nothing while no task is running", async () => {
    const component = await mountSuspended(AppTaskIndicator);

    expect(component.find(indicator).exists()).toBe(false);
  });

  it("shows the running task with its progress message", async () => {
    const component = await mountSuspended(AppTaskIndicator);

    emitTask({
      id: 1,
      name: "noop",
      state: "in_progress",
      progress: 0.25,
      message: "3/12 disks",
    });
    await nextTick();

    expect(component.text()).toContain("Noop");
    expect(component.text()).toContain("3/12 disks");
  });

  it("hides again once the task finishes", async () => {
    const component = await mountSuspended(AppTaskIndicator);

    emitTask({ id: 2, name: "noop", state: "in_progress" });
    await nextTick();
    expect(component.find(indicator).exists()).toBe(true);

    emitTask({ id: 2, name: "noop", state: "done" });
    await nextTick();
    expect(component.find(indicator).exists()).toBe(false);
  });

  it("shows only the icon when the sidebar is collapsed", async () => {
    const component = await mountSuspended(AppTaskIndicator, {
      props: { collapsed: true },
    });

    emitTask({ id: 3, name: "noop", state: "in_progress", message: "sdc" });
    await nextTick();

    expect(component.find(indicator).exists()).toBe(true);
    expect(component.text()).not.toContain("sdc");
  });
});
