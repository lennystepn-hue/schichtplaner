/**
 * POST /api/ai/chat
 *
 * AI Chat endpoint that handles multi-turn conversation with Claude
 * using tool-use for interacting with the Schichtplaner system.
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";
import { isAIFeatureEnabled, AIError } from "@/lib/ai/client";
import { checkRateLimit } from "@/lib/ai/rate-limiter";
import { chatTools, executeTool } from "@/lib/ai/chat-tools";

const SYSTEM_PROMPT = `Du bist der KI-Assistent im Schichtplaner. Du hilfst bei der Schichtplanung, beantwortest Fragen zu Mitarbeitern und Stunden, und kannst Aktionen ausfuehren. Antworte in der Sprache des Nutzers.

Wichtige Regeln:
- Sei freundlich und hilfsbereit
- Verwende die Tools, um Daten abzufragen oder Aktionen auszufuehren
- Nenne bei Mitarbeitern immer den vollen Namen
- Formatiere Schichtzeiten als HH:mm
- Bei zerstoererischen Aktionen (Schicht erstellen, Buchung) weise den Nutzer darauf hin
- Wenn du keine relevanten Daten findest, sage das ehrlich
- Halte Antworten kompakt und uebersichtlich`;

const MODEL = "claude-sonnet-4-20250514";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
}

// Map our tool definitions to Anthropic tool format
const anthropicTools: Anthropic.Messages.Tool[] = chatTools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.input_schema as Anthropic.Messages.Tool.InputSchema,
}));

// Build a lookup for which tools require confirmation
const confirmationTools = new Set(
  chatTools.filter((t) => t.requiresConfirmation).map((t) => t.name)
);

export async function POST(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Die Werkzeuge fragen organisationsweit ab - nur fuer die Administration.
  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
  }

  // Check feature flag
  const enabled = await isAIFeatureEnabled(
    member.organizationId,
    "chatEnabled"
  );
  if (!enabled) {
    return NextResponse.json(
      { error: "KI-Chat ist fuer diese Organisation deaktiviert" },
      { status: 403 }
    );
  }

  // Rate limiting
  const rateResult = checkRateLimit(member.organizationId);
  if (!rateResult.allowed) {
    return NextResponse.json(
      {
        error: `Rate-Limit erreicht. Bitte in ${rateResult.retryAfter}s erneut versuchen.`,
      },
      { status: 429 }
    );
  }

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json(
      { error: "messages array is required" },
      { status: 400 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY nicht konfiguriert" },
      { status: 500 }
    );
  }

  const client = new Anthropic({ apiKey });

  try {
    // Build the messages for Claude
    const messages: Anthropic.Messages.MessageParam[] = body.messages.map(
      (msg) => ({
        role: msg.role,
        content: msg.content,
      })
    );

    // Initial Claude call with tools
    let response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: anthropicTools,
      messages,
    });

    // Tool-use loop: keep calling tools until Claude produces a final text response
    const toolResults: Array<{
      toolName: string;
      toolInput: Record<string, unknown>;
      result: string;
      requiresConfirmation: boolean;
    }> = [];

    let loopCount = 0;
    const MAX_TOOL_LOOPS = 5;

    while (response.stop_reason === "tool_use" && loopCount < MAX_TOOL_LOOPS) {
      loopCount++;

      // Find all tool_use blocks
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.Messages.ToolUseBlock =>
          block.type === "tool_use"
      );

      // Execute each tool
      const toolResultBlocks: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        const result = await executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          member.organizationId,
          member.userId
        );

        toolResults.push({
          toolName: toolUse.name,
          toolInput: toolUse.input as Record<string, unknown>,
          result: result.content,
          requiresConfirmation: confirmationTools.has(toolUse.name),
        });

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result.content,
        });
      }

      // Continue conversation with tool results
      messages.push({
        role: "assistant",
        content: response.content,
      });
      messages.push({
        role: "user",
        content: toolResultBlocks,
      });

      response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: anthropicTools,
        messages,
      });
    }

    // Extract final text response
    const textBlocks = response.content.filter(
      (block): block is Anthropic.Messages.TextBlock => block.type === "text"
    );
    const responseText = textBlocks.map((b) => b.text).join("\n");

    return NextResponse.json({
      message: responseText,
      toolResults,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    });
  } catch (error) {
    if (error instanceof AIError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "RATE_LIMITED" ? 429 : 500 }
      );
    }

    console.error("[AI Chat] Error:", error);
    const message =
      error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json(
      { error: `KI-Chat Fehler: ${message}` },
      { status: 500 }
    );
  }
}
