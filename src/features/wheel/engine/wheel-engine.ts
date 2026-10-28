export const FULL_TURN = 360;
export const WHEEL_START_ANGLE = -90;
export const POINTER_ANGLE = -90;
const UINT32_RANGE = 0x1_0000_0000;

export interface SegmentAngles {
  readonly start: number;
  readonly end: number;
  readonly center: number;
}

export type RandomUint32 = () => number;

function assertSegmentCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 2 || count > UINT32_RANGE) {
    throw new RangeError("A wheel must contain between 2 and 2^32 segments.");
  }
}

function assertSegmentIndex(index: number, count: number): void {
  assertSegmentCount(count);
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError("The segment index must belong to the wheel.");
  }
}

export function normalizeDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) {
    throw new RangeError("Rotation must be a finite number.");
  }

  const normalized = ((degrees % FULL_TURN) + FULL_TURN) % FULL_TURN;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function getSegmentAngles(index: number, count: number): SegmentAngles {
  assertSegmentIndex(index, count);
  const segmentSize = FULL_TURN / count;
  const start = WHEEL_START_ANGLE + index * segmentSize;
  return {
    start,
    end: start + segmentSize,
    center: start + segmentSize / 2,
  };
}

export function getSegmentIndexAtPointer(rotation: number, count: number): number {
  assertSegmentCount(count);
  if (!Number.isFinite(rotation)) {
    throw new RangeError("Rotation must be a finite number.");
  }

  const pointerInWheel = normalizeDegrees(POINTER_ANGLE - rotation);
  const relativeAngle = normalizeDegrees(pointerInWheel - WHEEL_START_ANGLE);
  return Math.min(Math.floor(relativeAngle / (FULL_TURN / count)), count - 1);
}

export function getLandingRotation(index: number, count: number): number {
  assertSegmentIndex(index, count);
  const { center } = getSegmentAngles(index, count);
  return normalizeDegrees(POINTER_ANGLE - center);
}

export function calculateSpinTarget(
  currentRotation: number,
  selectedIndex: number,
  count: number,
  fullSpins = 5,
): number {
  assertSegmentIndex(selectedIndex, count);
  if (!Number.isFinite(currentRotation)) {
    throw new RangeError("Current rotation must be finite.");
  }
  if (!Number.isInteger(fullSpins) || fullSpins < 1) {
    throw new RangeError("A spin must include at least one full rotation.");
  }

  const destination = getLandingRotation(selectedIndex, count);
  const extraTurn = normalizeDegrees(destination - normalizeDegrees(currentRotation));
  return currentRotation + fullSpins * FULL_TURN + extraTurn;
}

function cryptoUint32(): number {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure randomness is unavailable in this browser.");
  }

  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  const value = values[0];
  if (value === undefined) {
    throw new Error("Secure randomness could not be read.");
  }
  return value;
}

export function selectRandomIndex(count: number, randomUint32: RandomUint32 = cryptoUint32): number {
  assertSegmentCount(count);
  const acceptedRange = Math.floor(UINT32_RANGE / count) * count;

  for (;;) {
    const value = randomUint32();
    if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) {
      throw new RangeError("The random source must return an unsigned 32-bit integer.");
    }
    if (value < acceptedRange) {
      return value % count;
    }
  }
}
