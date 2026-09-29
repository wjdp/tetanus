export const DEMO_SEED = 0x7e7a_2026;

const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
const HEX = "0123456789abcdef";

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(list: readonly T[]): T;
  gaussian(mean: number, sd: number): number;
  alnum(length: number): string;
  digits(length: number): string;
  hex(length: number): string;
}

export function hashString(value: string, seed = DEMO_SEED): number {
  let hash = seed ^ 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));
  const fromAlphabet = (alphabet: string, length: number) =>
    Array.from({ length }, () => alphabet[int(0, alphabet.length - 1)]).join(
      "",
    );
  return {
    next,
    int,
    pick: (list) => list[int(0, list.length - 1)] as (typeof list)[number],
    gaussian: (mean, sd) => {
      const u = 1 - next();
      const v = next();
      return (
        mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
      );
    },
    alnum: (length) => fromAlphabet(ALNUM, length),
    digits: (length) => fromAlphabet("0123456789", length),
    hex: (length) => fromAlphabet(HEX, length),
  };
}

export function forkRng(key: string): Rng {
  return createRng(hashString(key));
}

export function guidFor(key: string): string {
  const high = BigInt(hashString(key, DEMO_SEED));
  const low = BigInt(hashString(key, DEMO_SEED ^ 0x5bd1e995));
  return ((high << 32n) | low).toString();
}
