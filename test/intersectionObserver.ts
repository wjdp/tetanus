import { vi } from "vitest";

type ObserverCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;

const observed = new Map<Element, ObserverCallback>();

class FakeIntersectionObserver {
  constructor(private readonly callback: ObserverCallback) {}
  observe(target: Element) {
    observed.set(target, this.callback);
  }
  unobserve(target: Element) {
    observed.delete(target);
  }
  disconnect() {
    for (const [target, callback] of observed)
      if (callback === this.callback) observed.delete(target);
  }
}

/** Replaces IntersectionObserver so a test decides when an element is in view. */
export function stubIntersectionObserver() {
  observed.clear();
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
}

export function scrollIntoView(target: Element | undefined) {
  if (!target) throw new Error("nothing to scroll to");
  const callback = observed.get(target);
  if (!callback) throw new Error("element is not observed");
  callback([{ isIntersecting: true, time: Date.now(), target }]);
}
