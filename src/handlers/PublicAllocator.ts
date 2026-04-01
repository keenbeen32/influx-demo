import { PublicAllocator } from "generated";
import { flowCapId, marketId } from "../utils/ids.js";

PublicAllocator.SetFlowCaps.handler(async ({ event, context }) => {
  const vaultAddress = event.params.vault;
  const configs = event.params.config;

  for (const [id, caps] of configs) {
    const mId = marketId(event.chainId, id);
    const fcId = flowCapId(event.chainId, vaultAddress, id);

    // Fetch old flow cap to compute delta for shared liquidity
    const oldFlowCap = await context.FlowCap.get(fcId);
    const oldMaxIn = oldFlowCap?.maxIn ?? 0n;
    const newMaxIn = caps[0]; // maxIn
    const newMaxOut = caps[1]; // maxOut

    context.FlowCap.set({
      id: fcId,
      chainId: event.chainId,
      vault: vaultAddress,
      market_id: mId,
      maxIn: newMaxIn,
      maxOut: newMaxOut,
    });

    // Update Market.publicAllocatorSharedLiquidity with the delta
    const market = await context.Market.get(mId);
    if (market) {
      const delta = newMaxIn - oldMaxIn;
      context.Market.set({
        ...market,
        publicAllocatorSharedLiquidity:
          market.publicAllocatorSharedLiquidity + delta,
      });
    }
  }
});
