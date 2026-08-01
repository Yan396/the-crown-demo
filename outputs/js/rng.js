export const RNG_ALGORITHM = "mulberry32-v1";

const INCREMENT = 0x6d2b79f5;

export function createRng(seed) {
  return {
    algorithm: RNG_ALGORITHM,
    value: Number(seed) >>> 0,
    draws: 0
  };
}

export function nextUint32(rng) {
  rng.value = (rng.value + INCREMENT) >>> 0;
  let mixed = rng.value;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  rng.draws += 1;
  return (mixed ^ (mixed >>> 14)) >>> 0;
}

export function nextFloat(rng) {
  return nextUint32(rng) / 4294967296;
}

export function randomBetween(rng, minimum, maximum) {
  return minimum + (maximum - minimum) * nextFloat(rng);
}

export function randomInt(rng, minimum, maximumExclusive) {
  return minimum + Math.floor(nextFloat(rng) * (maximumExclusive - minimum));
}

export function isValidRng(rng) {
  return Boolean(
    rng &&
    rng.algorithm === RNG_ALGORITHM &&
    Number.isInteger(rng.value) &&
    rng.value >= 0 &&
    rng.value <= 0xffffffff &&
    Number.isSafeInteger(rng.draws) &&
    rng.draws >= 0
  );
}
