import { BigDecimal } from "generated";

const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60; // 31_557_600
const WAD = 1e18;

/**
 * Compute annualized borrow APY from per-second rate (WAD-scaled).
 * Formula: (1 + ratePerSecond / 1e18) ^ SECONDS_PER_YEAR - 1
 *
 * Uses JS floating point — sufficient precision for APY display.
 */
export function computeBorrowApy(borrowRatePerSecond: bigint): BigDecimal {
  const rateFloat = Number(borrowRatePerSecond) / WAD;
  const apy = Math.pow(1 + rateFloat, SECONDS_PER_YEAR) - 1;
  return BigDecimal(apy.toString());
}

/**
 * Compute utilization = totalBorrowAssets / totalSupplyAssets.
 * Returns 0 if totalSupplyAssets is 0.
 */
export function computeUtilization(
  totalBorrowAssets: bigint,
  totalSupplyAssets: bigint,
): BigDecimal {
  if (totalSupplyAssets === 0n) return BigDecimal("0");
  const util = Number(totalBorrowAssets) / Number(totalSupplyAssets);
  return BigDecimal(util.toString());
}

/**
 * Compute supply APY = borrowApy * utilization * (1 - fee/WAD).
 * fee is WAD-scaled (1e18 = 100%).
 */
export function computeSupplyApy(
  borrowRatePerSecond: bigint,
  totalBorrowAssets: bigint,
  totalSupplyAssets: bigint,
  fee: bigint,
): BigDecimal {
  const rateFloat = Number(borrowRatePerSecond) / WAD;
  const borrowApy = Math.pow(1 + rateFloat, SECONDS_PER_YEAR) - 1;

  if (totalSupplyAssets === 0n) return BigDecimal("0");
  const utilization = Number(totalBorrowAssets) / Number(totalSupplyAssets);
  const feeMultiplier = 1 - Number(fee) / WAD;
  const supplyApy = borrowApy * utilization * feeMultiplier;
  return BigDecimal(supplyApy.toString());
}
