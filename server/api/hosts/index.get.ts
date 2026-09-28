import { listHosts } from "~~/server/services/hosts";

export default defineEventHandler(() => listHosts());
