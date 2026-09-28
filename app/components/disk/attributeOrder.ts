import type { DiskProtocol } from "#shared/disk";
import type { AttributeStatus } from "#shared/smart/status";

interface RankedAttribute {
  attrId: string;
  status: AttributeStatus;
}

const STATUS_RANK: Record<AttributeStatus, number> = {
  failed: 0,
  warning: 1,
  passed: 2,
};

const TEMPERATURE_ATTRIBUTE: Partial<Record<DiskProtocol, string>> = {
  ata: "194",
  nvme: "temperature",
};

export function orderAttributes<T extends RankedAttribute>(
  attributes: T[],
): T[] {
  return [...attributes].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status],
  );
}

export function defaultAttributeId(
  attributes: RankedAttribute[],
  protocol: DiskProtocol | null,
): string | null {
  const [first] = orderAttributes(attributes);
  if (!first) return null;
  if (first.status !== "passed") return first.attrId;
  const temperatureId = protocol ? TEMPERATURE_ATTRIBUTE[protocol] : undefined;
  const temperature = attributes.find(
    (attribute) => attribute.attrId === temperatureId,
  );
  return temperature?.attrId ?? first.attrId;
}

export function countByStatus(attributes: RankedAttribute[]) {
  return {
    failed: attributes.filter((attribute) => attribute.status === "failed")
      .length,
    warning: attributes.filter((attribute) => attribute.status === "warning")
      .length,
  };
}
