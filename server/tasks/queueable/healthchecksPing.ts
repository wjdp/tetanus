import { pingHealthchecks } from "~~/server/services/healthchecks";

export default async () => {
  await pingHealthchecks();
};
