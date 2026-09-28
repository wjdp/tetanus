import { z } from "zod";
import { ServiceError } from "~~/server/utils/serviceError";

export type FetchImpl = typeof fetch;

export const SCRUTINY_TIMEOUT_MS = 30_000;

const timestamp = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const text = z
  .string()
  .nullish()
  .transform((value) => value ?? "");
const count = z
  .number()
  .nullish()
  .transform((value) => value ?? null);

export const scrutinyDeviceSchema = z
  .looseObject({
    scrutiny_uuid: text,
    wwn: text,
    device_name: text,
    model_name: text,
    serial_number: text,
    firmware: text,
    capacity: z.number().nullish(),
    rotational_speed: z.number().nullish(),
    form_factor: text,
    device_protocol: text,
    device_type: text,
    interface_type: text,
    archived: z.boolean().nullish(),
    CreatedAt: timestamp,
    UpdatedAt: timestamp,
  })
  .refine((device) => device.scrutiny_uuid !== "" || device.wwn !== "", {
    message: "device has neither scrutiny_uuid nor wwn",
  });

export const scrutinyAttributeSchema = z.looseObject({
  attribute_id: z.union([z.number(), z.string()]),
  value: z.number(),
  thresh: z.number().nullish(),
  worst: z.number().nullish(),
  raw_value: z.number().nullish(),
  raw_string: z.string().nullish(),
  when_failed: z.string().nullish(),
});

export const scrutinySmartPointSchema = z.looseObject({
  date: timestamp,
  device_protocol: text,
  temp: count,
  power_on_hours: count,
  power_cycle_count: count,
  attrs: z
    .record(z.string(), scrutinyAttributeSchema)
    .nullish()
    .transform((attrs) => attrs ?? {}),
});

const temperaturePointSchema = z.looseObject({
  date: timestamp,
  temp: z.number(),
});

export const scrutinySummarySchema = z.looseObject({
  summary: z.record(
    z.string(),
    z.looseObject({
      device: scrutinyDeviceSchema,
      temp_history: z.array(temperaturePointSchema).nullish(),
    }),
  ),
});

export const scrutinyDetailsSchema = z.looseObject({
  device: scrutinyDeviceSchema,
  smart_results: z
    .array(scrutinySmartPointSchema)
    .nullish()
    .transform((points) => points ?? []),
});

export const scrutinyTemperatureHistorySchema = z.looseObject({
  temp_history: z.record(z.string(), z.array(temperaturePointSchema)),
});

const envelopeSchema = z.looseObject({
  success: z.boolean(),
  data: z.unknown(),
  errors: z.unknown().optional(),
});

export type ScrutinyDevice = z.infer<typeof scrutinyDeviceSchema>;
export type ScrutinyAttribute = z.infer<typeof scrutinyAttributeSchema>;
export type ScrutinySmartPoint = z.infer<typeof scrutinySmartPointSchema>;
export type ScrutinyTemperaturePoint = z.infer<typeof temperaturePointSchema>;
export type ScrutinySummary = z.infer<typeof scrutinySummarySchema>;
export type ScrutinyDetails = z.infer<typeof scrutinyDetailsSchema>;
export type ScrutinyTemperatureHistory = z.infer<
  typeof scrutinyTemperatureHistorySchema
>;

export function scrutinyDeviceKey(device: ScrutinyDevice): string {
  return device.scrutiny_uuid || device.wwn;
}

function apiUrl(baseUrl: string, path: string): URL {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  if (!URL.canParse(base)) {
    throw new ServiceError(400, `Invalid scrutiny URL: ${baseUrl}`);
  }
  return new URL(`api/${path}`, base);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function getJson(url: URL, fetchImpl: FetchImpl): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(SCRUTINY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ServiceError(
      502,
      `scrutiny unreachable at ${url}: ${describe(error)}`,
    );
  }
  if (!response.ok) {
    throw new ServiceError(
      502,
      `scrutiny returned ${response.status} for ${url}`,
    );
  }
  try {
    return await response.json();
  } catch (error) {
    throw new ServiceError(
      502,
      `scrutiny sent invalid JSON for ${url}: ${describe(error)}`,
    );
  }
}

async function getData<T>(
  url: URL,
  schema: z.ZodType<T>,
  fetchImpl: FetchImpl,
): Promise<T> {
  const envelope = envelopeSchema.safeParse(await getJson(url, fetchImpl));
  if (!envelope.success) {
    throw new ServiceError(502, `scrutiny sent an unexpected body for ${url}`);
  }
  if (!envelope.data.success) {
    throw new ServiceError(502, `scrutiny reported failure for ${url}`);
  }
  const data = schema.safeParse(envelope.data.data);
  if (!data.success) {
    throw new ServiceError(
      502,
      `scrutiny response for ${url} did not match the expected shape: ${z.prettifyError(data.error)}`,
    );
  }
  return data.data;
}

export interface ScrutinyClient {
  summary(): Promise<ScrutinySummary>;
  details(deviceKey: string): Promise<ScrutinyDetails>;
  temperatureHistory(): Promise<ScrutinyTemperatureHistory>;
}

export function createScrutinyClient(
  baseUrl: string,
  fetchImpl: FetchImpl = fetch,
): ScrutinyClient {
  return {
    summary: () =>
      getData(apiUrl(baseUrl, "summary"), scrutinySummarySchema, fetchImpl),
    details: (deviceKey) => {
      const url = apiUrl(
        baseUrl,
        `device/${encodeURIComponent(deviceKey)}/details`,
      );
      url.searchParams.set("duration_key", "forever");
      return getData(url, scrutinyDetailsSchema, fetchImpl);
    },
    temperatureHistory: () => {
      const url = apiUrl(baseUrl, "summary/temp");
      url.searchParams.set("duration_key", "forever");
      return getData(url, scrutinyTemperatureHistorySchema, fetchImpl);
    },
  };
}
