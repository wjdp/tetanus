import { restore } from "~~/server/services/simulator/run";

export default defineEventHandler(() => {
  requireSimulator();
  return restore();
});
