import { createHash, timingSafeEqual } from "node:crypto";
import type { H3Event } from "h3";
import {
  HOST_HEADER,
  hostNameSchema,
  INGEST_BODY_LIMIT_BYTES,
  ingestMetaSchema,
} from "#shared/ingest";
import { recordIngest } from "~~/server/services/ingest";
import { getSettings } from "~~/server/services/settings";
import { demoForbidden, isDemo } from "~~/server/utils/demo";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

const BEARER_PREFIX = "Bearer ";

const digest = (value: string) => createHash("sha256").update(value).digest();

function tokensMatch(presented: string, expected: string) {
  return timingSafeEqual(digest(presented), digest(expected));
}

async function requireEnrolToken(event: H3Event) {
  const authorization = getRequestHeader(event, "authorization") ?? "";
  const presented = authorization.startsWith(BEARER_PREFIX)
    ? authorization.slice(BEARER_PREFIX.length).trim()
    : "";
  const { enrolToken } = await getSettings();
  if (!presented || !tokensMatch(presented, enrolToken)) {
    throw createError({
      statusCode: 401,
      statusMessage: "Invalid enrol token",
    });
  }
}

function requireHostName(event: H3Event) {
  const result = hostNameSchema.safeParse(
    getRequestHeader(event, HOST_HEADER) ?? "",
  );
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: `Missing or invalid ${HOST_HEADER} header`,
    });
  }
  return result.data;
}

function payloadTooLarge(): never {
  throw createError({
    statusCode: 413,
    statusMessage: `Body exceeds ${INGEST_BODY_LIMIT_BYTES} bytes`,
  });
}

async function readLimitedBody(event: H3Event) {
  const declaredLength = Number(getRequestHeader(event, "content-length") ?? 0);
  if (declaredLength > INGEST_BODY_LIMIT_BYTES) payloadTooLarge();
  const body = (await readRawBody(event, "utf8")) ?? "";
  if (Buffer.byteLength(body, "utf8") > INGEST_BODY_LIMIT_BYTES) {
    payloadTooLarge();
  }
  return body;
}

export default defineEventHandler(async (event) => {
  if (isDemo()) demoForbidden("Ingest is disabled in the demo");
  await requireEnrolToken(event);
  const hostName = requireHostName(event);
  const meta = await getValidatedQuery(event, ingestMetaSchema.parse);
  const body = await readLimitedBody(event);

  const outcome = await respondWithServiceErrors(async () =>
    recordIngest({
      hostName,
      source: getRouterParam(event, "source") ?? "",
      meta,
      body,
      producer: getRequestHeader(event, "user-agent") ?? null,
    }),
  );
  if (!outcome.ok) setResponseStatus(event, 422);
  return outcome;
});
