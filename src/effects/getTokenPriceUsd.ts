import { createEffect, S } from "envio";

const CHAIN_NAMES: Record<number, string> = {
  1776: "injective",
};

export const getTokenPriceUsd = createEffect(
  {
    name: "getTokenPriceUsd",
    input: S.schema({
      address: S.string,
      chainId: S.number,
    }),
    output: S.schema({
      priceUsd: S.number,
    }),
    cache: false,
    rateLimit: false,
  },
  async ({ input }) => {
    try {
      const chain = CHAIN_NAMES[input.chainId] ?? "injective";
      const key = `${chain}:${input.address}`;
      const url = `https://coins.llama.fi/prices/current/${key}`;
      const res = await fetch(url);
      if (!res.ok) return { priceUsd: 0 };
      const data = (await res.json()) as {
        coins: Record<string, { price?: number }>;
      };
      // DefiLlama key matching is case-sensitive, try exact match first
      const price = data.coins[key]?.price ?? 0;
      return { priceUsd: price };
    } catch {
      return { priceUsd: 0 };
    }
  },
);
