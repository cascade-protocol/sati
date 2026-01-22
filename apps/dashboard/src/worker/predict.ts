/**
 * AI Prediction Service with Kalshi Market Data
 *
 * Combines Kalshi prediction market data fetching with AI prediction generation.
 * Uses Vercel AI SDK with Claude for market analysis.
 */

import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

// =============================================================================
// Kalshi Types
// =============================================================================

export interface KalshiMarket {
  ticker: string;
  title: string;
  subtitle?: string;
  yesPrice: number; // decimal (0-1)
  noPrice: number; // decimal (0-1)
  volume: number;
  closeTime: string;
  eventTicker: string;
  status: string;
}

interface KalshiApiMarket {
  ticker: string;
  title: string;
  subtitle?: string;
  yes_bid: number; // cents (0-100)
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number; // cents (0-100)
  volume: number;
  volume_24h: number;
  liquidity: number; // total liquidity in cents
  close_time: string;
  event_ticker: string;
  status: string;
}

interface KalshiMarketsResponse {
  markets: KalshiApiMarket[];
  cursor?: string;
}

// =============================================================================
// Kalshi Constants
// =============================================================================

// Public API endpoint (works for all markets, not just elections)
const KALSHI_API_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// Popular series to fetch markets from
const POPULAR_SERIES = [
  "KXBTC", // Bitcoin price
  "KXETH", // Ethereum price
  "KXGDPQ", // GDP growth
  "KXCPI", // CPI inflation
  "KXUNEMPLOY", // Unemployment rate
  "KXFED", // Fed interest rate
];

// =============================================================================
// Kalshi API Functions
// =============================================================================

/**
 * Fetch a single popular market from Kalshi.
 * Tries crypto/economics series first, then falls back to general markets.
 */
export async function fetchPopularMarket(): Promise<KalshiMarket | null> {
  // First, try to fetch from preferred series (crypto, economics)
  for (const series of POPULAR_SERIES) {
    const seriesUrl = `${KALSHI_API_BASE}/markets?series_ticker=${series}&status=open&limit=20`;
    try {
      const response = await fetch(seriesUrl, {
        headers: { Accept: "application/json" },
      });

      if (response.ok) {
        const data: KalshiMarketsResponse = await response.json();
        if (data.markets && data.markets.length > 0) {
          // Find market with best liquidity and interesting price (not near 0 or 100)
          const goodMarket = data.markets
            .filter((m) => {
              const midPrice = (m.yes_bid + m.yes_ask) / 2;
              // Look for markets with interesting prices (10-90 cents)
              return midPrice >= 10 && midPrice <= 90 && m.liquidity > 0;
            })
            .sort((a, b) => b.liquidity - a.liquidity)[0];

          if (goodMarket) {
            return transformMarket(goodMarket);
          }
        }
      }
    } catch (e) {
      console.error(`Error fetching series ${series}:`, e);
    }
  }

  // Fallback: try to get any open market with activity
  const url = `${KALSHI_API_BASE}/markets?status=open&limit=100`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    console.error("Kalshi API error:", response.status, await response.text());
    return null;
  }

  const data: KalshiMarketsResponse = await response.json();

  if (!data.markets || data.markets.length === 0) {
    return null;
  }

  // Sort by liquidity and filter for tradeable markets
  const sortedMarkets = data.markets
    .filter((m) => {
      const midPrice = (m.yes_bid + m.yes_ask) / 2;
      // Filter for markets with interesting prices
      return midPrice >= 10 && midPrice <= 90;
    })
    .sort((a, b) => b.liquidity - a.liquidity);

  if (sortedMarkets.length > 0) {
    return transformMarket(sortedMarkets[0]);
  }

  // Last resort: any market with some bid/ask activity
  const anyMarket = data.markets.find((m) => m.yes_bid > 0 && m.yes_ask < 100);
  if (anyMarket) {
    return transformMarket(anyMarket);
  }

  return null;
}

// TODO: Future feature - allow users to select specific markets
/**
 * Fetch a specific market by ticker.
 */
export async function fetchMarket(ticker: string): Promise<KalshiMarket | null> {
  const url = `${KALSHI_API_BASE}/markets/${ticker}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    console.error("Kalshi API error:", response.status, await response.text());
    return null;
  }

  const data: { market: KalshiApiMarket } = await response.json();

  if (!data.market) {
    return null;
  }

  return transformMarket(data.market);
}

// TODO: Future feature - allow users to browse markets by series
/**
 * Fetch markets from a specific series.
 */
export async function fetchMarketsFromSeries(seriesTicker: string): Promise<KalshiMarket[]> {
  const url = `${KALSHI_API_BASE}/markets?series_ticker=${seriesTicker}&status=open&limit=10`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    console.error("Kalshi API error:", response.status, await response.text());
    return [];
  }

  const data: KalshiMarketsResponse = await response.json();

  if (!data.markets) {
    return [];
  }

  return data.markets.map(transformMarket);
}

// =============================================================================
// Kalshi Helpers
// =============================================================================

/**
 * Transform Kalshi API market to our internal format.
 */
function transformMarket(market: KalshiApiMarket): KalshiMarket {
  // Kalshi prices are in cents (0-100), convert to decimal (0-1)
  // Use midpoint of bid/ask for the price, or last_price if available
  const yesPrice = market.last_price > 0 ? market.last_price / 100 : (market.yes_bid + market.yes_ask) / 2 / 100;
  const noPrice = 1 - yesPrice;

  return {
    ticker: market.ticker,
    title: market.title,
    subtitle: market.subtitle,
    yesPrice,
    noPrice,
    volume: market.volume,
    closeTime: market.close_time,
    eventTicker: market.event_ticker,
    status: market.status,
  };
}

/**
 * Format market close time for display.
 */
export function formatCloseTime(closeTime: string): string {
  const date = new Date(closeTime);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ${diffHours % 24}h`;
  } else if (diffHours > 0) {
    return `${diffHours}h`;
  } else {
    const diffMins = Math.floor(diffMs / (1000 * 60));
    return `${diffMins}m`;
  }
}

// =============================================================================
// Prediction Types
// =============================================================================

/**
 * Schema for AI prediction output - validated by Zod
 */
const PredictionSchema = z.object({
  prediction: z.enum(["yes", "no"]).describe("Binary prediction outcome - YES or NO"),
  confidence: z
    .number()
    .describe("Confidence percentage from 0 to 100. Be calibrated - only use high confidence (>80) when very certain."),
  reasoning: z.string().describe("Brief explanation of the prediction reasoning in 1-3 sentences (max 500 chars)"),
});

export type PredictionResult = z.infer<typeof PredictionSchema>;

// =============================================================================
// Prediction Generation
// =============================================================================

/**
 * Generate an AI prediction for a Kalshi market using Claude.
 *
 * @param apiKey - Anthropic API key
 * @param market - Kalshi market to predict
 * @returns Structured prediction with outcome, confidence, and reasoning
 */
export async function generatePrediction(apiKey: string, market: KalshiMarket): Promise<PredictionResult> {
  const anthropic = createAnthropic({ apiKey });

  const timeRemaining = formatCloseTime(market.closeTime);

  const { output } = await generateText({
    model: anthropic("claude-sonnet-4-5-20250929"),
    output: Output.object({
      schema: PredictionSchema,
    }),
    prompt: `You are a prediction market analyst. Analyze this market and provide your prediction.

MARKET INFORMATION:
- Title: ${market.title}
${market.subtitle ? `- Details: ${market.subtitle}` : ""}
- Current YES price: $${market.yesPrice.toFixed(2)} (market's implied probability: ${(market.yesPrice * 100).toFixed(0)}%)
- Current NO price: $${market.noPrice.toFixed(2)}
- Time until close: ${timeRemaining}
- Trading volume: ${market.volume.toLocaleString()} contracts

INSTRUCTIONS:
1. Analyze the market question and current pricing
2. Consider base rates and relevant factors
3. Provide your prediction (YES or NO)
4. Rate your confidence (0-100%). Be well-calibrated:
   - 50-60%: Slight edge over market
   - 60-70%: Moderate confidence
   - 70-80%: High confidence
   - 80%+: Very high confidence (rare, requires strong evidence)
5. Explain your reasoning briefly

Note: The market price already reflects collective wisdom. Only deviate significantly if you have a strong reason.`,
  });

  return output;
}

/**
 * Check if a prediction passes the confidence threshold.
 *
 * @param confidence - Prediction confidence (0-100)
 * @param threshold - Minimum threshold for passing validation (default: 60)
 * @returns true if confidence >= threshold
 */
export function passesConfidenceThreshold(confidence: number, threshold: number = 60): boolean {
  return confidence >= threshold;
}
