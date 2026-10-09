/**
 * Claude AI client wrapper.
 *
 * Provides a singleton Anthropic client, an AI feature-gate check,
 * and a high-level `generateAIResponse` helper that enforces rate
 * limiting and feature flags before calling Claude.
 */

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { checkRateLimit } from "./rate-limiter";
import { isAIAllowedByServer } from "@/lib/security";

// ─── Error types ────────────────────────────────────────────────────

export class AIError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "AI_DISABLED"
      | "RATE_LIMITED"
      | "API_ERROR"
      | "MISSING_API_KEY"
      | "INVALID_RESPONSE",
    public readonly retryAfter?: number
  ) {
    super(message);
    this.name = "AIError";
  }
}

// ─── Singleton client ───────────────────────────────────────────────

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!isAIAllowedByServer()) {
    throw new AIError("KI-Funktionen sind auf diesem Server deaktiviert", "AI_DISABLED");
  }
  if (_client) return _client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AIError(
      "ANTHROPIC_API_KEY ist nicht konfiguriert",
      "MISSING_API_KEY"
    );
  }

  _client = new Anthropic({ apiKey });
  return _client;
}

// ─── AI feature names ───────────────────────────────────────────────

export type AIFeature =
  | "autoPlanner"
  | "anomalyDetection"
  | "chatEnabled"
  | "forecast"
  | "smartBriefing";

/** Map feature name to the OrgSettings boolean column. */
const featureToColumn: Record<AIFeature, string> = {
  autoPlanner: "aiAutoPlanner",
  anomalyDetection: "aiAnomalyDetection",
  chatEnabled: "aiChatEnabled",
  forecast: "aiForecast",
  smartBriefing: "aiSmartBriefing",
};

/**
 * Check whether a specific AI feature is enabled for the given org.
 * Returns `true` if:
 *   1. aiEnabled is true (global toggle), AND
 *   2. The specific feature flag is true.
 *
 * Always `false` unless the server sets AI_ENABLED=true.
 * If no OrgSettings row exists yet, defaults to disabled.
 */
export async function isAIFeatureEnabled(
  orgId: string,
  feature: AIFeature
): Promise<boolean> {
  if (!isAIAllowedByServer()) return false;

  const settings = await db.orgSettings.findUnique({
    where: { organizationId: orgId },
  });

  // No settings row -> AI stays off (opt-in only)
  if (!settings) return false;

  // Global kill switch
  if (!settings.aiEnabled) return false;

  // Per-feature flag
  const column = featureToColumn[feature];
  return (settings as Record<string, unknown>)[column] === true;
}

// ─── High-level response helper ─────────────────────────────────────

export interface GenerateAIParams {
  orgId: string;
  feature: AIFeature;
  systemPrompt: string;
  userMessage: string;
  /** Maximum tokens in the response. Default: 4096 */
  maxTokens?: number;
  /** Override the default model. */
  model?: string;
}

export interface AIResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Generate a response from Claude.
 *
 * 1. Checks that the AI feature is enabled for the org.
 * 2. Applies rate limiting (20 req/min per org).
 * 3. Calls Claude and returns the text response.
 */
export async function generateAIResponse(
  params: GenerateAIParams
): Promise<AIResponse> {
  const {
    orgId,
    feature,
    systemPrompt,
    userMessage,
    maxTokens = 4096,
    model = DEFAULT_MODEL,
  } = params;

  // 1. Feature gate
  const enabled = await isAIFeatureEnabled(orgId, feature);
  if (!enabled) {
    throw new AIError(
      `KI-Feature "${feature}" ist fuer diese Organisation deaktiviert`,
      "AI_DISABLED"
    );
  }

  // 2. Rate limiting
  const rateResult = checkRateLimit(orgId);
  if (!rateResult.allowed) {
    throw new AIError(
      `Rate-Limit erreicht. Bitte in ${rateResult.retryAfter}s erneut versuchen.`,
      "RATE_LIMITED",
      rateResult.retryAfter
    );
  }

  // 3. Call Claude
  const client = getClient();

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    // Extract text content
    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new AIError(
        "Claude hat keine Textantwort zurueckgegeben",
        "INVALID_RESPONSE"
      );
    }

    return {
      content: textBlock.text,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch (error) {
    // Re-throw our own errors
    if (error instanceof AIError) throw error;

    // Wrap Anthropic SDK / network errors
    const message =
      error instanceof Error ? error.message : "Unbekannter KI-Fehler";
    throw new AIError(`Claude API Fehler: ${message}`, "API_ERROR");
  }
}
