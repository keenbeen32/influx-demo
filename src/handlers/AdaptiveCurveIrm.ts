import { AdaptiveCurveIRM } from "generated";
import { marketId } from "../utils/ids.js";
import {
  computeBorrowApy,
  computeSupplyApy,
  computeUtilization,
} from "../utils/apy.js";
import { computeIrmCurve } from "../utils/irmCurve.js";

AdaptiveCurveIRM.BorrowRateUpdate.handler(async ({ event, context }) => {
  const id = marketId(event.chainId, event.params.id);
  const existing = await context.Market.get(id);
  if (!existing) return;

  const borrowRatePerSecond = event.params.avgBorrowRate;

  context.Market.set({
    ...existing,
    rateAtTarget: event.params.rateAtTarget,
    borrowRatePerSecond,
    currentBorrowApy: computeBorrowApy(borrowRatePerSecond),
    currentSupplyApy: computeSupplyApy(
      borrowRatePerSecond,
      existing.totalBorrowAssets,
      existing.totalSupplyAssets,
      existing.fee,
    ),
    currentUtilization: computeUtilization(
      existing.totalBorrowAssets,
      existing.totalSupplyAssets,
    ),
    irmCurve: computeIrmCurve(event.params.rateAtTarget, existing.fee),
  });
});
