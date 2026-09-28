import { createError } from "h3";
import { ServiceError } from "~~/server/utils/serviceError";

export async function respondWithServiceErrors<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ServiceError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message,
        message: error.message,
      });
    }
    throw error;
  }
}
