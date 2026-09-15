export interface Clock {
  /**
   * Returns current timestamp in microseconds.
   */
  nowUs(): bigint;

  /**
   * Returns current timestamp in wall-clock milliseconds.
   */
  nowMs(): number;

  /**
   * For virtual clocks: advances time by deltaUs.
   */
  advanceUs?(deltaUs: bigint): void;
}
