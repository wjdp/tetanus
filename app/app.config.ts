import { APP_NAME } from "#shared/app";

export default defineAppConfig({
  title: APP_NAME,
  ui: {
    colors: {
      primary: "rust",
      neutral: "stone",
      error: "alarm",
      warning: "amber",
      success: "emerald",
      info: "sky",
      secondary: "stone",
    },
  },
});
