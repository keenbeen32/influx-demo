const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60; // 31_557_600
const WAD = 1e18;
const TARGET_UTILIZATION = 0.9;
const CURVE_STEEPNESS = 4;
const NUM_POINTS = 21; // 0%, 5%, 10%, ..., 100%

export function computeIrmCurve(
  rateAtTarget: bigint,
  fee: bigint,
): Array<{ utilization: number; borrowApy: number; supplyApy: number }> {
  if (rateAtTarget === 0n) return [];

  const rateAtTargetFloat = Number(rateAtTarget) / WAD;
  const feeMultiplier = 1 - Number(fee) / WAD;
  const curve: Array<{ utilization: number; borrowApy: number; supplyApy: number }> = [];

  for (let i = 0; i < NUM_POINTS; i++) {
    const u = i / (NUM_POINTS - 1); // 0.0 to 1.0

    let exponent: number;
    if (u <= TARGET_UTILIZATION) {
      exponent = CURVE_STEEPNESS * (u / TARGET_UTILIZATION - 1);
    } else {
      exponent = CURVE_STEEPNESS * (u - TARGET_UTILIZATION) / (1 - TARGET_UTILIZATION);
    }

    const borrowRatePerSec = rateAtTargetFloat * Math.exp(exponent);
    const borrowApy = Math.pow(1 + borrowRatePerSec, SECONDS_PER_YEAR) - 1;
    const supplyApy = borrowApy * u * feeMultiplier;

    curve.push({
      utilization: u,
      borrowApy,
      supplyApy,
    });
  }

  return curve;
}
