import type { DataRequest } from "@/lib/types";
import type { FetchResult } from "./common";
import { fetchBars as fetchYahooBars } from "./yahoo";
import { fetchBars as fetchPolymarketBars } from "./polymarket";

export type { FetchResult } from "./common";

export async function fetchBars(req: DataRequest): Promise<FetchResult> {
  switch (req.source) {
    case "polymarket":
      return fetchPolymarketBars(req);
    case "stock":
      return fetchYahooBars(req);
  }
}
