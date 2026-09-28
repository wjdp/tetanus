import { listPools } from "~~/server/services/zfs";

export default defineEventHandler(() => listPools());
