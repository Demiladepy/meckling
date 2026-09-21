// Sample Nansen responses for development and tests without an API key. Reports built from these carry
// `source: "fixture"` and the UI labels them "Sample data"; they are never used for a submitted mandate.
import { NansenClient } from "./nansen.ts";

type Handler = (body: Record<string, unknown>) => unknown;

const page = { page: 1, per_page: 100, is_last_page: true };

/** A risk-off BTC tape: smart money net short at high leverage, with net outflows. */
const perpPositions: Record<string, unknown[]> = {
  BTC: [
    { address: "0x01", address_label: "Smart Trader", side: "Short", position_value_usd: 4_200_000, position_size: 49, leverage: "8x", leverage_type: "cross", entry_price: 86_100, mark_price: 85_000, liquidation_price: 95_000, funding_usd: 1200, upnl_usd: 54_000 },
    { address: "0x02", address_label: "Fund", side: "Short", position_value_usd: 2_900_000, position_size: 34, leverage: "5x", leverage_type: "cross", entry_price: 85_900, mark_price: 85_000, liquidation_price: 99_000, funding_usd: 800, upnl_usd: 30_600 },
    { address: "0x03", address_label: "30D Smart Trader", side: "Long", position_value_usd: 1_100_000, position_size: 13, leverage: "10x", leverage_type: "isolated", entry_price: 84_700, mark_price: 85_000, liquidation_price: 77_000, funding_usd: -300, upnl_usd: 3_900 },
  ],
  ETH: [
    { address: "0x04", address_label: "Smart Trader", side: "Long", position_value_usd: 1_500_000, position_size: 549, leverage: "4x", leverage_type: "cross", entry_price: 2700, mark_price: 2730, liquidation_price: 2100, funding_usd: -200, upnl_usd: 16_000 },
    { address: "0x05", address_label: "Fund", side: "Short", position_value_usd: 1_300_000, position_size: 476, leverage: "3x", leverage_type: "cross", entry_price: 2750, mark_price: 2730, liquidation_price: 3600, funding_usd: 150, upnl_usd: 9_500 },
  ],
  MON: [
    { address: "0x06", address_label: "Smart Trader", side: "Long", position_value_usd: 600_000, position_size: 23_500_000, leverage: "3x", leverage_type: "cross", entry_price: 0.024, mark_price: 0.0255, liquidation_price: 0.017, funding_usd: -40, upnl_usd: 35_000 },
  ],
  SOL: [],
};

const netflow: Record<string, unknown> = {
  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599": { token_address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", token_symbol: "WBTC", net_flow_1h_usd: -120_000, net_flow_24h_usd: -2_400_000, net_flow_7d_usd: -9_800_000, net_flow_30d_usd: -14_000_000, chain: "ethereum", token_sectors: [], trader_count: 41, token_age_days: 2400, market_cap_usd: 12_000_000_000 },
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": { token_address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", token_symbol: "WETH", net_flow_1h_usd: 10_000, net_flow_24h_usd: 300_000, net_flow_7d_usd: 400_000, net_flow_30d_usd: -1_000_000, chain: "ethereum", token_sectors: [], trader_count: 88, token_age_days: 3000, market_cap_usd: 9_000_000_000 },
  "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A": { token_address: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A", token_symbol: "WMON", net_flow_1h_usd: 20_000, net_flow_24h_usd: 450_000, net_flow_7d_usd: 3_100_000, net_flow_30d_usd: 6_000_000, chain: "monad", token_sectors: [], trader_count: 57, token_age_days: 300, market_cap_usd: 2_500_000_000 },
};

const handlers: Record<string, Handler> = {
  "/tgm/perp-positions": (b) => ({ data: perpPositions[String(b.token_symbol)] ?? [], pagination: page }),
  "/smart-money/netflow": (b) => {
    const addr = String((b.filters as { token_address?: string } | undefined)?.token_address);
    const row = netflow[addr];
    return { data: row ? [row] : [], pagination: page };
  },
  "/tgm/holders": (b) => {
    const smart = b.label_type === "smart_money";
    const rows = Array.from({ length: smart ? 12 : 10 }, (_, i) => ({
      address: `0x${i}`,
      address_label: smart ? "Smart Trader" : "Holder",
      token_amount: 1000 - i,
      total_inflow: 0,
      total_outflow: 0,
      balance_change_24h: 0,
      balance_change_7d: 0,
      balance_change_30d: 0,
      ownership_percentage: String(b.token_address).startsWith("0x3bd3") ? 7.5 : 3.1,
      value_usd: 1,
    }));
    return { data: rows, pagination: page };
  },
  "/smart-money/pnl-leaderboard": () => ({ data: [], pagination: page }),
};

export function fixtureFetch(failPaths: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/api/v1", "");
    if (failPaths.includes(path)) return new Response('{"error":"plan does not include this endpoint"}', { status: 403 });
    const handler = handlers[path];
    if (!handler) return new Response("not found", { status: 404 });
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify(handler(body)), { status: 200, headers: { "x-nansen-credits-cost": "1" } });
  }) as typeof fetch;
}

export function fixtureClient(failPaths: string[] = []): NansenClient {
  return new NansenClient("fixture", undefined, fixtureFetch(failPaths));
}
