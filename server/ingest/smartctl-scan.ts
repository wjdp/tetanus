import type { Parser } from "#shared/ingest";
import { ParseError } from "./parseError";

export interface SmartctlScanDevice {
  name: string;
  type: string;
  protocol: string;
  infoName: string;
}

export interface SmartctlScanResult {
  smartctl: { version: string; exitStatus: number };
  devices: SmartctlScanDevice[];
}

function parseJson(body: string): Record<string, unknown> {
  if (body.trim() === "") throw new ParseError("Empty smartctl-scan body");
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ParseError("smartctl-scan body is not valid JSON");
  }
  if (typeof json !== "object" || json === null) {
    throw new ParseError("smartctl-scan body is not a JSON object");
  }
  return json as Record<string, unknown>;
}

export const parse: Parser<SmartctlScanResult> = (body) => {
  const json = parseJson(body);
  const smartctl = json.smartctl as Record<string, unknown> | undefined;
  if (!smartctl || !Array.isArray(smartctl.version)) {
    throw new ParseError("smartctl-scan body missing smartctl.version");
  }

  const version = (smartctl.version as unknown[]).join(".");
  const exitStatus = Number(smartctl.exit_status ?? 0);
  const rawDevices = Array.isArray(json.devices) ? json.devices : [];
  const devices: SmartctlScanDevice[] = rawDevices.map((entry) => {
    const device = entry as Record<string, unknown>;
    return {
      name: String(device.name),
      type: String(device.type),
      protocol: String(device.protocol),
      infoName: String(device.info_name),
    };
  });

  return {
    data: { smartctl: { version, exitStatus }, devices },
    summary: { devices: devices.length },
  };
};
