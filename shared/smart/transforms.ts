type Transform = (value: number, rawValue: number, rawString: string) => number;

function seagateCommandTimeout(
  _value: number,
  rawValue: number,
  rawString: string,
): number {
  const pieces = rawString.split(" ");
  if (pieces.length !== 3) return rawValue;
  if (!pieces.every((piece) => /^[+-]?\d+$/.test(piece))) return rawValue;
  const [first, second, third] = pieces.map(Number) as [number, number, number];
  return third >= second && second >= first ? third : rawValue;
}

function lowestByte(_value: number, rawValue: number): number {
  return Number(BigInt(rawValue) & 0xffn);
}

const TRANSFORMS: Record<string, Transform> = {
  "188": seagateCommandTimeout,
  "194": lowestByte,
};

export function hasTransform(attrId: string | number): boolean {
  return Object.hasOwn(TRANSFORMS, String(attrId));
}

export function transform(
  attrId: string | number,
  value: number,
  rawValue: number,
  rawString: string,
): number {
  const fn = TRANSFORMS[String(attrId)];
  return fn ? fn(value, rawValue, rawString) : rawValue;
}
