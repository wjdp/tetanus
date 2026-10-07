import { config, enableAutoUnmount } from "@vue/test-utils";
import { afterEach } from "vitest";
import { defineComponent } from "vue";

enableAutoUnmount(afterEach);

// UTooltip needs the provider UApp installs in app.vue; components are mounted alone.
config.global.stubs.UTooltip = defineComponent({
  props: { text: { type: String, default: undefined } },
  setup:
    (props, { slots }) =>
    () =>
      slots.default?.({ text: props.text }),
});
