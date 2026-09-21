// Typed client for the Nansen endpoints confirmed in spike S6 (docs/spikes.md). Nothing else is called.
// Docs: https://docs.nansen.ai — base https://api.nansen.ai/api/v1, auth header `apikey`.

export const NANSEN_BASE_URL = "https://api.nansen.ai/api/v1";

export type NansenChain =
  | "all"
  | "arbitrum"
  | "avalanche"
  | "base"
  | "bnb"
  | "ethereum"
  | "hyperevm"
  | "linea"
  | "mantle"
  | "monad"
  | "optimism"
  | "polygon"
  | "solana"
  | "sonic";

export type SortDirection = "ASC" | "DESC";
export interface OrderBy<F extends string> {
  field: F;
  direction: SortDirection;
}
export interface Pagination {
  page: number;
  per_page: number; // max 1000
}
export interface PageInfo extends Pagination {
  is_last_page: boolean;
}
export interface Range {
  min?: number;
  max?: number;
}
export interface Page<T> {
  data: T[];
  pagination: PageInfo;
  /** From the X-Nansen-Credits-Cost response header, if present. */
  creditsCost?: number;
}

// ---- POST /smart-money/netflow ----
export interface NetflowRequest {
  chains: NansenChain[];
  filters?: {
    include_smart_money_labels?: string[];
    exclude_smart_money_labels?: string[];
    token_address?: string;
    include_stablecoins?: boolean;
    include_native_tokens?: boolean;
    token_sector?: string[];
    trader_count?: Range;
    token_age_days?: Range;
    market_cap_usd?: Range;
  };
  pagination?: Pagination;
  order_by?: OrderBy<"net_flow_1h_usd" | "net_flow_24h_usd" | "net_flow_7d_usd" | "net_flow_30d_usd">[];
}
export interface NetflowRow {
  token_address: string;
  token_symbol: string;
  net_flow_1h_usd: number;
  net_flow_24h_usd: number;
  net_flow_7d_usd: number;
  net_flow_30d_usd: number;
  chain: string;
  token_sectors: string[];
  trader_count: number;
  token_age_days: number;
  market_cap_usd: number;
}

// ---- POST /tgm/holders ----
export type HolderLabelType = "all_holders" | "smart_money" | "exchange" | "whale" | "public_figure";
export interface HoldersRequest {
  chain: NansenChain;
  token_address: string;
  label_type?: HolderLabelType;
  aggregate_by_entity?: boolean;
  premium_labels?: boolean;
  filters?: {
    include_smart_money_labels?: string[];
    token_amount?: Range;
    value_usd?: Range;
    ownership_percentage?: Range;
  };
  pagination?: Pagination;
  order_by?: OrderBy<"value_usd" | "token_amount" | "ownership_percentage" | "balance_change_24h">[];
}
export interface HolderRow {
  address: string;
  address_label: string;
  token_amount: number;
  total_inflow: number;
  total_outflow: number;
  balance_change_24h: number;
  balance_change_7d: number;
  balance_change_30d: number;
  ownership_percentage: number;
  value_usd: number;
}

// ---- POST /tgm/perp-positions (Hyperliquid) ----
export type PerpLabelType = "all_traders" | "smart_money" | "whale" | "public_figure";
export interface PerpPositionsRequest {
  token_symbol: string;
  label_type?: PerpLabelType;
  filters?: {
    include_smart_money_labels?: string[];
    exclude_smart_money_labels?: string[];
    side?: "Long" | "Short";
    position_value_usd?: Range;
    upnl_usd?: Range;
  };
  pagination?: Pagination;
  order_by?: OrderBy<"position_value_usd" | "leverage" | "upnl_usd">[];
}
export interface PerpPositionRow {
  address: string;
  address_label: string;
  side: "Long" | "Short";
  position_value_usd: number;
  position_size: number;
  leverage: string; // e.g. "10x"
  leverage_type: string; // "cross" | "isolated"
  entry_price: number;
  mark_price: number;
  liquidation_price: number;
  funding_usd: number;
  upnl_usd: number;
}

// ---- POST /smart-money/pnl-leaderboard ----
export interface PnlLeaderboardRequest {
  chains: NansenChain[];
  timeframe?: 1 | 7 | 30 | 90 | 180;
  filters?: { include_smart_money_labels?: string[]; exclude_smart_money_labels?: string[] };
  pagination?: Pagination;
  order_by?: OrderBy<"total_pnl_usd" | "realized_pnl_usd" | "win_rate" | "n_trades">[];
}
export interface PnlLeaderboardRow {
  address: string;
  address_label: string;
  realized_pnl_usd: number;
  unrealized_pnl_usd: number;
  total_pnl_usd: number;
  avg_trade_roi: number;
  roi_percent_unrealised: number;
  win_rate: number;
  n_trades: number;
  n_tokens: number;
  open_trades: number;
  held_tokens_count: number;
}

export class NansenError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: string;

  constructor(status: number, path: string, body: string) {
    super(`Nansen ${path} failed with ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

export class NansenClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, baseUrl: string = NANSEN_BASE_URL, fetchImpl: typeof fetch = fetch) {
    if (!apiKey) throw new Error("NANSEN_API_KEY is not set");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  private async post<T>(path: string, body: unknown): Promise<Page<T>> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { apikey: this.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new NansenError(res.status, path, text);
    const parsed = JSON.parse(text) as { data: T[]; pagination: PageInfo };
    const cost = res.headers.get("x-nansen-credits-cost");
    return { ...parsed, ...(cost !== null ? { creditsCost: Number(cost) } : {}) };
  }

  smartMoneyNetflow(req: NetflowRequest) {
    return this.post<NetflowRow>("/smart-money/netflow", req);
  }
  tokenHolders(req: HoldersRequest) {
    return this.post<HolderRow>("/tgm/holders", req);
  }
  perpPositions(req: PerpPositionsRequest) {
    return this.post<PerpPositionRow>("/tgm/perp-positions", req);
  }
  smartMoneyPnlLeaderboard(req: PnlLeaderboardRequest) {
    return this.post<PnlLeaderboardRow>("/smart-money/pnl-leaderboard", req);
  }
}
