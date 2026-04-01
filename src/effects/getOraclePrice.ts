import { createEffect, S } from "envio";
import { createPublicClient, http, parseAbi } from "viem";

const ORACLE_ABI = parseAbi([
  "function price() view returns (uint256)",
]);

const RPC_URLS: Record<number, string> = {
  1776: process.env.RPC_URL_1776 ?? "https://injective.drpc.org",
};

export const getOraclePrice = createEffect(
  {
    name: "getOraclePrice",
    input: S.schema({
      oracleAddress: S.string,
      chainId: S.number,
    }),
    output: S.schema({
      price: S.string, // BigInt as string for serialization
    }),
    cache: false,
    rateLimit: false,
  },
  async ({ input }) => {
    try {
      const rpcUrl =
        RPC_URLS[input.chainId] ?? Object.values(RPC_URLS)[0];
      const client = createPublicClient({
        transport: http(rpcUrl),
      });

      const price = await client.readContract({
        address: input.oracleAddress as `0x${string}`,
        abi: ORACLE_ABI,
        functionName: "price",
      });

      return { price: price.toString() };
    } catch {
      return { price: "0" };
    }
  },
);
