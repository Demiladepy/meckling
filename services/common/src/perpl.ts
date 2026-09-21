// Perpl units and order encoding (docs/spikes.md S1). CNS = collateral units (AUSD, 6 decimals), PNS = price units
// (per-market priceDecimals), LNS = lot units (per-market lotDecimals).
import { encodeFunctionData, type Address, type Hex } from "viem";
import { perplExchangeAbi } from "./abis.ts";
import type { MarketInfo } from "./networks.ts";

export const COLLATERAL_DECIMALS = 6;

export const OrderType = {
  OpenLong: 0,
  OpenShort: 1,
  CloseLong: 2,
  CloseShort: 3,
  Cancel: 4,
  IncreasePositionCollateral: 5,
} as const;
export type OrderType = (typeof OrderType)[keyof typeof OrderType];

export interface Call {
  target: Address;
  data: Hex;
}

export interface OrderDesc {
  orderDescId: bigint;
  perpId: bigint;
  orderType: number;
  orderId: bigint;
  pricePNS: bigint;
  lotLNS: bigint;
  expiryBlock: bigint;
  postOnly: boolean;
  fillOrKill: boolean;
  immediateOrCancel: boolean;
  maxMatches: bigint;
  leverageHdths: bigint;
  lastExecutionBlock: bigint;
  amountCNS: bigint;
  maxNegPnlCollatBPS: bigint;
}

/** USD (float) -> collateral units. */
export function usdToCns(usd: number): bigint {
  return BigInt(Math.round(usd * 10 ** COLLATERAL_DECIMALS));
}

export function cnsToUsd(cns: bigint): number {
  return Number(cns) / 10 ** COLLATERAL_DECIMALS;
}

export function priceToPns(m: MarketInfo, price: number): bigint {
  return BigInt(Math.round(price * 10 ** m.priceDecimals));
}

export function pnsToPrice(m: MarketInfo, pns: bigint): number {
  return Number(pns) / 10 ** m.priceDecimals;
}

/** Lots for a USD notional at `price`, rounded down (never exceeds the requested notional). */
export function usdToLots(m: MarketInfo, usd: number, price: number): bigint {
  return BigInt(Math.floor((usd / price) * 10 ** m.lotDecimals));
}

/** Notional in collateral units, computed exactly as PerplAdapter.notionalOf does on-chain. */
export function notionalCns(m: MarketInfo, lotLNS: bigint, pricePNS: bigint): bigint {
  return (lotLNS * pricePNS * 10n ** BigInt(COLLATERAL_DECIMALS)) / 10n ** BigInt(m.priceDecimals + m.lotDecimals);
}

export interface OrderParams {
  market: MarketInfo;
  type: OrderType;
  lots: bigint;
  /** Limit price in PNS. For marketable IOC orders pass mark +- slippage. */
  limitPricePNS: bigint;
  /** Per-position margin leverage on Perpl (not the mandate's account leverage). */
  venueLeverage?: number;
  orderDescId?: bigint;
  orderId?: bigint;
  fillOrKill?: boolean;
}

export function orderDesc(p: OrderParams): OrderDesc {
  return {
    orderDescId: p.orderDescId ?? BigInt(Date.now()),
    perpId: BigInt(p.market.perpId),
    orderType: p.type,
    orderId: p.orderId ?? 0n,
    pricePNS: p.limitPricePNS,
    lotLNS: p.lots,
    expiryBlock: 0n,
    postOnly: false,
    fillOrKill: p.fillOrKill ?? false,
    // Opens must be immediate (docs/decisions.md D1); closes and cancels too, so nothing rests.
    immediateOrCancel: !(p.fillOrKill ?? false),
    maxMatches: 0n,
    leverageHdths: BigInt(Math.round((p.venueLeverage ?? 10) * 100)),
    lastExecutionBlock: 0n,
    amountCNS: 0n,
    maxNegPnlCollatBPS: 1000n,
  };
}

export function execOrdersCall(exchange: Address, descs: OrderDesc[]): Call {
  return { target: exchange, data: encodeFunctionData({ abi: perplExchangeAbi, functionName: "execOrders", args: [descs, true] }) };
}

/** Marketable limit: mark +- slippage bps, in the direction that lets the order fill. */
export function marketableLimit(markPNS: bigint, isBuy: boolean, slippageBps = 100): bigint {
  return isBuy ? (markPNS * (10_000n + BigInt(slippageBps))) / 10_000n : (markPNS * (10_000n - BigInt(slippageBps))) / 10_000n;
}

export function approveCall(token: Address, spender: Address, amount: bigint): Call {
  return {
    target: token,
    data: encodeFunctionData({
      abi: [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] }],
      functionName: "approve",
      args: [spender, amount],
    }),
  };
}

export function createAccountCall(exchange: Address, amountCNS: bigint): Call {
  return { target: exchange, data: encodeFunctionData({ abi: perplExchangeAbi, functionName: "createAccount", args: [amountCNS] }) };
}

export function depositCall(exchange: Address, amountCNS: bigint): Call {
  return { target: exchange, data: encodeFunctionData({ abi: perplExchangeAbi, functionName: "depositCollateral", args: [amountCNS] }) };
}
