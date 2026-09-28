type Transform = (value: number, rawValue: number, rawString: string) => number;

function leadingInteger(
  _value: number,
  rawValue: number,
  rawString: string,
): number {
  const match = /^\s*(\d+)/.exec(rawString);
  if (!match) return rawValue;
  const parsed = Number(match[1]);
  return parsed > Number.MAX_SAFE_INTEGER ? rawValue : parsed;
}

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

const TRANSFORMS: Record<string, Transform> = {
  "188": seagateCommandTimeout,
};

export function transform(
  attrId: string | number,
  value: number,
  rawValue: number,
  rawString: string,
): number {
  const fn = TRANSFORMS[String(attrId)] ?? leadingInteger;
  return fn(value, rawValue, rawString);
}
