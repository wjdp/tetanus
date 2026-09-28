import { describe, expect, it } from "vitest";
import {
  createScrutinyClient,
  scrutinyDeviceKey,
} from "~~/server/services/importers/scrutinyApi";
import {
  ATA_KEY,
  NVME_KEY,
  SCRUTINY_TEST_URL,
  scrutinyFixtureFetch,
  UNMATCHED_KEY,
} from "~~/server/services/importers/scrutinyFixtureFetch";

function client(fetchImpl = scrutinyFixtureFetch()) {
  return createScrutinyClient(SCRUTINY_TEST_URL, fetchImpl);
}

describe("scrutiny API client", () => {
  it("parses the summary keyed by wwn, NVMe keyed by serial", async () => {
    const { summary } = await client().summary();

    expect(Object.keys(summary).sort()).toEqual(
      [ATA_KEY, NVME_KEY, UNMATCHED_KEY].sort(),
    );
    const ata = summary[ATA_KEY].device;
    expect(scrutinyDeviceKey(ata)).toBe(ATA_KEY);
    expect(ata).toMatchObject({
      model_name: "WDC WD120EMAZ-11BLFA0",
      serial_number: "1AQLP5ME",
      device_protocol: "ATA",
      device_name: "sdb",
      scrutiny_uuid: "",
    });
    expect(ata.CreatedAt).toEqual(new Date("2021-01-05T20:50:43.367Z"));
    expect(summary[NVME_KEY].device).toMatchObject({
      wwn: NVME_KEY,
      device_protocol: "NVMe",
      model_name: "WDS250G3X0C-00SJG0",
    });
    expect(summary[ATA_KEY].temp_history?.length).toBeGreaterThan(0);
  });

  it("parses ATA details with numeric attribute ids", async () => {
    const details = await client().details(ATA_KEY);

    expect(details.smart_results).toHaveLength(5);
    const [newest] = details.smart_results;
    expect(newest.date).toEqual(new Date("2026-09-28T21:23:01.164Z"));
    expect(newest.attrs["197"]).toMatchObject({
      attribute_id: 197,
      value: 100,
      worst: 100,
      thresh: 0,
      raw_value: 16,
      when_failed: "",
    });
  });

  it("parses NVMe details with named attributes lacking worst and raw", async () => {
    const details = await client().details(NVME_KEY);

    const media = details.smart_results[0].attrs.media_errors;
    expect(media).toMatchObject({ attribute_id: "media_errors", thresh: 0 });
    expect(media.worst).toBeUndefined();
    expect(media.raw_value).toBeUndefined();
  });

  it("parses the forever temperature history", async () => {
    const { temp_history } = await client().temperatureHistory();

    expect(Object.keys(temp_history).sort()).toEqual(
      [ATA_KEY, NVME_KEY].sort(),
    );
    expect(temp_history[ATA_KEY][0]).toEqual({
      date: new Date("2021-01-05T21:00:00Z"),
      temp: 39,
    });
  });

  it("requests the forever duration from the details and temp endpoints", async () => {
    const fetchImpl = scrutinyFixtureFetch();
    await client(fetchImpl).details(ATA_KEY);
    await client(fetchImpl).temperatureHistory();

    expect(fetchImpl.requests.map(String)).toEqual([
      `${SCRUTINY_TEST_URL}/api/device/${ATA_KEY}/details?duration_key=forever`,
      `${SCRUTINY_TEST_URL}/api/summary/temp?duration_key=forever`,
    ]);
  });

  it("accepts scrutiny_uuid as the device key", async () => {
    const uuid = "7f1c2f0e-3c4b-5d6e-8f90-a1b2c3d4e5f6";
    const summary = JSON.stringify({
      success: true,
      data: {
        summary: {
          [uuid]: {
            device: {
              scrutiny_uuid: uuid,
              model_name: "Some disk",
              serial_number: "ABC",
              CreatedAt: "2024-01-01T00:00:00Z",
              UpdatedAt: "2024-02-01T00:00:00Z",
              extra_field: true,
            },
          },
        },
      },
    });
    const fetchImpl = scrutinyFixtureFetch({ "/api/summary": summary });

    const parsed = await client(fetchImpl).summary();

    expect(scrutinyDeviceKey(parsed.summary[uuid].device)).toBe(uuid);
  });

  it.each([
    ["a non-2xx status", new Response("boom", { status: 500 })],
    ["success: false", JSON.stringify({ success: false, errors: ["nope"] })],
    ["a body that is not JSON", "<html>"],
    [
      "a device without a key",
      JSON.stringify({
        success: true,
        data: {
          summary: {
            x: {
              device: {
                CreatedAt: "2024-01-01T00:00:00Z",
                UpdatedAt: "2024-01-01T00:00:00Z",
              },
            },
          },
        },
      }),
    ],
  ])("throws a 502 on %s", async (_label, response) => {
    const fetchImpl = scrutinyFixtureFetch({ "/api/summary": response });

    await expect(client(fetchImpl).summary()).rejects.toMatchObject({
      name: "ServiceError",
      statusCode: 502,
    });
  });

  it("throws a 502 when scrutiny is unreachable", async () => {
    const unreachable = async () => {
      throw new TypeError("fetch failed");
    };

    await expect(
      createScrutinyClient(SCRUTINY_TEST_URL, unreachable).summary(),
    ).rejects.toMatchObject({ statusCode: 502 });
  });
});
