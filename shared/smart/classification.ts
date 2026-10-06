export const ATTRIBUTE_CLASSES = ["defect", "context"] as const;
export type AttributeClass = (typeof ATTRIBUTE_CLASSES)[number];

export const DEFECT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "5",
  "10",
  "184",
  "187",
  "188",
  "196",
  "197",
  "198",
  "201",
]);

// Bump when classification, transforms or bucket rules change so stored statuses are recomputed at boot.
export const SMART_POLICY_VERSION = 6;

export function attributeClass(attrId: string | number): AttributeClass {
  return DEFECT_ATTRIBUTES.has(String(attrId)) ? "defect" : "context";
}
