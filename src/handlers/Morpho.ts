import { Morpho, BigDecimal } from "generated";
import {
  marketId,
  positionId,
  authorizationId,
  tokenId,
  GLOBAL_STATE_ID,
  ZERO_ADDRESS,
} from "../utils/ids.js";
import { getTokenMetadata } from "../effects/getTokenMetadata.js";
import { getOraclePrice } from "../effects/getOraclePrice.js";
import { computeIrmCurve } from "../utils/irmCurve.js";

const ZERO_BD = BigDecimal("0");

Morpho.CreateMarket.handler(async ({ event, context }) => {
  const id = marketId(event.chainId, event.params.id);
  const loanTokenAddr = event.params.marketParams[0];
  const collateralTokenAddr = event.params.marketParams[1];

  // Upsert Token entities for loan and collateral tokens (skip zero address for idle markets)
  const newTokenIds: string[] = [];
  for (const addr of [loanTokenAddr, collateralTokenAddr]) {
    if (addr === ZERO_ADDRESS) continue;
    const tId = tokenId(event.chainId, addr);
    const existing = await context.Token.get(tId);
    if (!existing) {
      const meta = await context.effect(getTokenMetadata, {
        address: addr,
        chainId: event.chainId,
      });
      context.Token.set({
        id: tId,
        chainId: event.chainId,
        address: addr,
        name: meta.name,
        symbol: meta.symbol,
        decimals: meta.decimals,
        priceUsd: ZERO_BD,
        icon: "",      // TODO: populate from static token metadata config
        category: "",  // TODO: populate from static token metadata config
      });
      newTokenIds.push(tId);
    }
  }

  context.Market.set({
    id,
    chainId: event.chainId,
    marketId: event.params.id,
    loanToken: loanTokenAddr,
    collateralToken: collateralTokenAddr,
    oracle: event.params.marketParams[2],
    irm: event.params.marketParams[3],
    lltv: event.params.marketParams[4],
    totalSupplyAssets: 0n,
    totalSupplyShares: 0n,
    totalBorrowAssets: 0n,
    totalBorrowShares: 0n,
    lastUpdate: BigInt(event.block.timestamp),
    fee: 0n,
    rateAtTarget: 0n,
    borrowRatePerSecond: 0n,
    currentBorrowApy: ZERO_BD,
    currentSupplyApy: ZERO_BD,
    currentUtilization: ZERO_BD,
    totalCollateral: 0n,
    oraclePrice: 0n,
    publicAllocatorSharedLiquidity: 0n,
    irmCurve: [],
    isIdle: true,
    liquidityAssets: 0n,
  });

  // Update GlobalState to track this market and new tokens
  const gs = await context.GlobalState.get(GLOBAL_STATE_ID);
  const existingTokenIds = gs ? (gs.tokenIds as string[]) : [];
  context.GlobalState.set({
    id: GLOBAL_STATE_ID,
    marketIds: [...(gs ? (gs.marketIds as string[]) : []), id],
    vaultIds: gs ? gs.vaultIds : [],
    tokenIds: [...existingTokenIds, ...newTokenIds],
  });
});

Morpho.SetFee.handler(async ({ event, context }) => {
  const id = marketId(event.chainId, event.params.id);
  const existing = await context.Market.getOrThrow(id);

  context.Market.set({
    ...existing,
    fee: event.params.newFee,
    lastUpdate: BigInt(event.block.timestamp),
    irmCurve: computeIrmCurve(existing.rateAtTarget, event.params.newFee),
  });
});

Morpho.AccrueInterest.handler(async ({ event, context }) => {
  const id = marketId(event.chainId, event.params.id);
  const existing = await context.Market.getOrThrow(id);

  const newTotalSupplyAssets = existing.totalSupplyAssets + event.params.interest;
  const newTotalBorrowAssets = existing.totalBorrowAssets + event.params.interest;

  // Fetch oracle price
  const oracleResult = await context.effect(getOraclePrice, {
    oracleAddress: existing.oracle,
    chainId: event.chainId,
  });

  context.Market.set({
    ...existing,
    totalSupplyAssets: newTotalSupplyAssets,
    totalSupplyShares: existing.totalSupplyShares + event.params.feeShares,
    totalBorrowAssets: newTotalBorrowAssets,
    lastUpdate: BigInt(event.block.timestamp),
    oraclePrice: BigInt(oracleResult.price),
    isIdle: newTotalSupplyAssets === 0n && newTotalBorrowAssets === 0n,
    liquidityAssets: newTotalSupplyAssets - newTotalBorrowAssets,
  });
});

Morpho.Supply.handler(async ({ event, context }) => {
  const mId = marketId(event.chainId, event.params.id);
  const market = await context.Market.getOrThrow(mId);
  const newTotalSupplyAssets = market.totalSupplyAssets + event.params.assets;
  context.Market.set({
    ...market,
    totalSupplyAssets: newTotalSupplyAssets,
    totalSupplyShares: market.totalSupplyShares + event.params.shares,
    lastUpdate: BigInt(event.block.timestamp),
    isIdle: newTotalSupplyAssets === 0n && market.totalBorrowAssets === 0n,
    liquidityAssets: newTotalSupplyAssets - market.totalBorrowAssets,
  });

  const pId = positionId(event.chainId, event.params.id, event.params.onBehalf);
  const position = await context.Position.getOrCreate({
    id: pId,
    chainId: event.chainId,
    market_id: mId,
    user: event.params.onBehalf,
    supplyShares: 0n,
    borrowShares: 0n,
    collateral: 0n,
  });
  context.Position.set({
    ...position,
    supplyShares: position.supplyShares + event.params.shares,
  });
});

Morpho.Withdraw.handler(async ({ event, context }) => {
  const mId = marketId(event.chainId, event.params.id);
  const market = await context.Market.getOrThrow(mId);
  const newTotalSupplyAssets = market.totalSupplyAssets - event.params.assets;
  context.Market.set({
    ...market,
    totalSupplyAssets: newTotalSupplyAssets,
    totalSupplyShares: market.totalSupplyShares - event.params.shares,
    lastUpdate: BigInt(event.block.timestamp),
    isIdle: newTotalSupplyAssets === 0n && market.totalBorrowAssets === 0n,
    liquidityAssets: newTotalSupplyAssets - market.totalBorrowAssets,
  });

  const pId = positionId(event.chainId, event.params.id, event.params.onBehalf);
  const position = await context.Position.getOrCreate({
    id: pId,
    chainId: event.chainId,
    market_id: mId,
    user: event.params.onBehalf,
    supplyShares: 0n,
    borrowShares: 0n,
    collateral: 0n,
  });
  context.Position.set({
    ...position,
    supplyShares: position.supplyShares - event.params.shares,
  });
});

Morpho.SupplyCollateral.handler(async ({ event, context }) => {
  const mId = marketId(event.chainId, event.params.id);
  const market = await context.Market.getOrThrow(mId);
  context.Market.set({
    ...market,
    totalCollateral: market.totalCollateral + event.params.assets,
    lastUpdate: BigInt(event.block.timestamp),
  });

  const pId = positionId(event.chainId, event.params.id, event.params.onBehalf);
  const position = await context.Position.getOrCreate({
    id: pId,
    chainId: event.chainId,
    market_id: mId,
    user: event.params.onBehalf,
    supplyShares: 0n,
    borrowShares: 0n,
    collateral: 0n,
  });
  context.Position.set({
    ...position,
    collateral: position.collateral + event.params.assets,
  });
});

Morpho.WithdrawCollateral.handler(async ({ event, context }) => {
  const mId = marketId(event.chainId, event.params.id);
  const market = await context.Market.getOrThrow(mId);
  context.Market.set({
    ...market,
    totalCollateral: market.totalCollateral - event.params.assets,
    lastUpdate: BigInt(event.block.timestamp),
  });

  const pId = positionId(event.chainId, event.params.id, event.params.onBehalf);
  const position = await context.Position.getOrCreate({
    id: pId,
    chainId: event.chainId,
    market_id: mId,
    user: event.params.onBehalf,
    supplyShares: 0n,
    borrowShares: 0n,
    collateral: 0n,
  });
  context.Position.set({
    ...position,
    collateral: position.collateral - event.params.assets,
  });
});

Morpho.Borrow.handler(async ({ event, context }) => {
  const mId = marketId(event.chainId, event.params.id);
  const market = await context.Market.getOrThrow(mId);
  const newTotalBorrowAssets = market.totalBorrowAssets + event.params.assets;
  context.Market.set({
    ...market,
    totalBorrowAssets: newTotalBorrowAssets,
    totalBorrowShares: market.totalBorrowShares + event.params.shares,
    lastUpdate: BigInt(event.block.timestamp),
    isIdle: market.totalSupplyAssets === 0n && newTotalBorrowAssets === 0n,
    liquidityAssets: market.totalSupplyAssets - newTotalBorrowAssets,
  });

  const pId = positionId(event.chainId, event.params.id, event.params.onBehalf);
  const position = await context.Position.getOrCreate({
    id: pId,
    chainId: event.chainId,
    market_id: mId,
    user: event.params.onBehalf,
    supplyShares: 0n,
    borrowShares: 0n,
    collateral: 0n,
  });
  context.Position.set({
    ...position,
    borrowShares: position.borrowShares + event.params.shares,
  });
});

Morpho.Repay.handler(async ({ event, context }) => {
  const mId = marketId(event.chainId, event.params.id);
  const market = await context.Market.getOrThrow(mId);
  const newTotalBorrowAssets = market.totalBorrowAssets - event.params.assets;
  context.Market.set({
    ...market,
    totalBorrowAssets: newTotalBorrowAssets,
    totalBorrowShares: market.totalBorrowShares - event.params.shares,
    lastUpdate: BigInt(event.block.timestamp),
    isIdle: market.totalSupplyAssets === 0n && newTotalBorrowAssets === 0n,
    liquidityAssets: market.totalSupplyAssets - newTotalBorrowAssets,
  });

  const pId = positionId(event.chainId, event.params.id, event.params.onBehalf);
  const position = await context.Position.getOrCreate({
    id: pId,
    chainId: event.chainId,
    market_id: mId,
    user: event.params.onBehalf,
    supplyShares: 0n,
    borrowShares: 0n,
    collateral: 0n,
  });
  context.Position.set({
    ...position,
    borrowShares: position.borrowShares - event.params.shares,
  });
});

Morpho.Liquidate.handler(async ({ event, context }) => {
  const mId = marketId(event.chainId, event.params.id);
  const market = await context.Market.getOrThrow(mId);
  const newTotalSupplyAssets = market.totalSupplyAssets - event.params.badDebtAssets;
  const newTotalBorrowAssets = market.totalBorrowAssets - event.params.repaidAssets;
  context.Market.set({
    ...market,
    totalSupplyAssets: newTotalSupplyAssets,
    totalSupplyShares: market.totalSupplyShares - event.params.badDebtShares,
    totalBorrowAssets: newTotalBorrowAssets,
    totalBorrowShares: market.totalBorrowShares - event.params.repaidShares,
    totalCollateral: market.totalCollateral - event.params.seizedAssets,
    lastUpdate: BigInt(event.block.timestamp),
    isIdle: newTotalSupplyAssets === 0n && newTotalBorrowAssets === 0n,
    liquidityAssets: newTotalSupplyAssets - newTotalBorrowAssets,
  });

  const pId = positionId(event.chainId, event.params.id, event.params.borrower);
  const position = await context.Position.getOrCreate({
    id: pId,
    chainId: event.chainId,
    market_id: mId,
    user: event.params.borrower,
    supplyShares: 0n,
    borrowShares: 0n,
    collateral: 0n,
  });
  context.Position.set({
    ...position,
    collateral: position.collateral - event.params.seizedAssets,
    borrowShares:
      position.borrowShares -
      event.params.repaidShares -
      event.params.badDebtShares,
  });
});

Morpho.SetAuthorization.handler(async ({ event, context }) => {
  const id = authorizationId(
    event.chainId,
    event.params.authorizer,
    event.params.authorized,
  );

  context.Authorization.set({
    id,
    chainId: event.chainId,
    authorizer: event.params.authorizer,
    authorizee: event.params.authorized,
    isAuthorized: event.params.newIsAuthorized,
  });
});
