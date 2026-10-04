import { databaseSize } from "~~/server/services/database";

export default defineEventHandler(() => databaseSize());
