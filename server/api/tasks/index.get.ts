import { getAllTasks } from "~~/server/tasks/queue";

export default defineEventHandler(async () => getAllTasks());
