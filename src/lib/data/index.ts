import type { DataRequest } from "@/lib/types";
import { fetchBars as fetchYahooBars, type FetchResult } from "./yahoo";
import { fetchBars as fetchPolymarketBars } from "./polymarket";

export type { FetchResult } from "./yahoo";

export async function fetchBars(req: DataRequest): Promise<FetchResult> {
  switch (req.source) {
    case "polymarket":
      return fetchPolymarketBars(req);
    case "stock":
      return fetchYahooBars(req);
  }
}
