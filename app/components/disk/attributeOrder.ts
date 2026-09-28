import type { DiskProtocol } from "#shared/disk";
import type { AttributeDisplayStatus } from "#shared/smart/status";

interface RankedAttribute {
  attrId: string;
  displayStatus: AttributeDisplayStatus;
}

const STATUS_RANK: Record<AttributeDisplayStatus, number> = {
  failed: 0,
  warning: 1,
  accepted: 2,
  passed: 3,
};

const TEMPERATURE_ATTRIBUTE: Partial<Record<DiskProtocol, string>> = {
  ata: "194",
  nvme: "temperature",
};

export function orderAttributes<T extends RankedAttribute>(
  attributes: T[],
): T[] {
  return [...attributes].sort(
    (a, b) => STATUS_RANK[a.displayStatus] - STATUS_RANK[b.displayStatus],
  );
}

export function defaultAttributeId(
  attributes: RankedAttribute[],
  protocol: DiskProtocol | null,
): string | null {
  const [first] = orderAttributes(attributes);
  if (!first) return null;
  if (first.displayStatus === "failed" || first.displayStatus === "warning") {
    return first.attrId;
  }
  const temperatureId = protocol ? TEMPERATURE_ATTRIBUTE[protocol] : undefined;
  const temperature = attributes.find(
    (attribute) => attribute.attrId === temperatureId,
  );
  return temperature?.attrId ?? first.attrId;
}

export function countByStatus(attributes: RankedAttribute[]) {
  const count = (status: AttributeDisplayStatus) =>
    attributes.filter((attribute) => attribute.displayStatus === status).length;
  return {
    failed: count("failed"),
    warning: count("warning"),
    accepted: count("accepted"),
  };
}
