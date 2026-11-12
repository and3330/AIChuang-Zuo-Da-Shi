import Anthropic from "@anthropic-ai/sdk";

/** Atlas catalog advertises image input for this Seed model.
 * Use its recommended Chat Completions endpoint, translating our existing
 * internal message shape to avoid changing every suggestion route:
 * https://www.atlascloud.ai/docs/en/llm-protocols
 * Inference runs on Atlas, not Claude. No provider fallback or automatic retry.
 */
export const ATLAS_SEED_MODEL = "bytedance/doubao-seed-character-260628";
export const ATLAS_SEED_BASE_URL = "https://api.atlascloud.ai";

export function createAtlasSeedClient(options: { fetch?: typeof fetch } = {}) {
  // Resolve lazily so a missing key fails the requested feature, not app startup.
  return {
    messages: {
      create: async (params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
        if (!process.env.ATLASCLOUD_API_KEY) {
          throw new Error("尚未設定 ATLASCLOUD_API_KEY，無法使用 Seed AI 規劃與建議。");
        }
        const messages: unknown[] = [];
        if (params.system) {
          messages.push({ role: "system", content: typeof params.system === "string"
            ? params.system : params.system.map(b => b.text).join("\n") });
        }
        for (const message of params.messages) {
          const content = typeof message.content === "string" ? message.content : message.content.map(block => {
            if (block.type === "text") return { type: "text", text: block.text };
            if (block.type === "image") {
              const url = block.source.type === "base64"
                ? `data:${block.source.media_type};base64,${block.source.data}`
                : block.source.url;
              return { type: "image_url", image_url: { url } };
            }
            throw new Error(`Seed AI 不支援目前的輸入類型：${block.type}`);
          });
          messages.push({ role: message.role, content });
        }
        const body: Record<string, unknown> = {
          model: ATLAS_SEED_MODEL, messages, max_tokens: params.max_tokens, stream: false,
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        };
        if (params.tools?.length) {
          body.tools = params.tools.map(tool => {
            if (!("input_schema" in tool)) throw new Error("Seed AI 不支援內建伺服器工具");
            return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.input_schema } };
          });
          const choice = params.tool_choice;
          body.tool_choice = choice?.type === "tool" ? { type: "function", function: { name: choice.name } }
            : choice?.type === "any" ? "required" : choice?.type === "none" ? "none" : "auto";
        }
        const response = await (options.fetch ?? fetch)(`${ATLAS_SEED_BASE_URL}/v1/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.ATLASCLOUD_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) {
          const message = `AtlasCloud Seed AI 請求失敗（HTTP ${response.status}）`;
          throw Anthropic.APIError.generate(response.status, { error: { message } }, message, response.headers);
        }
        const result = await response.json() as {
          id?: string; model?: string;
          choices?: Array<{ finish_reason: string; message: {
            content?: string | null; refusal?: string | null;
            tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
          } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const choice = result.choices?.[0];
        if (!choice?.message) throw new Error("AtlasCloud Seed AI 未回傳有效訊息");
        const stop_reason: Anthropic.Message["stop_reason"] =
          choice.finish_reason === "content_filter" || choice.message.refusal ? "refusal"
            : choice.finish_reason === "length" ? "max_tokens"
            : choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn";
        const content: Anthropic.ContentBlock[] = [];
        const text = choice.message.refusal || choice.message.content;
        if (text) content.push({ type: "text", text, citations: null });
        for (const tool of stop_reason === "refusal" || stop_reason === "max_tokens" ? [] : choice.message.tool_calls ?? []) {
          if (tool.type !== "function") throw new Error("AtlasCloud Seed AI 回傳不支援的工具類型");
          let input: unknown;
          try { input = JSON.parse(tool.function.arguments); }
          catch { throw new Error("AtlasCloud Seed AI 鏡頭工具參數格式不完整"); }
          content.push({ type: "tool_use", id: tool.id, name: tool.function.name, input, caller: { type: "direct" } });
        }
        return {
          id: result.id ?? "atlas-seed", type: "message", role: "assistant",
          model: result.model ?? ATLAS_SEED_MODEL, content, stop_reason, stop_sequence: null,
          usage: { input_tokens: result.usage?.prompt_tokens ?? 0, output_tokens: result.usage?.completion_tokens ?? 0,
            cache_creation_input_tokens: null, cache_read_input_tokens: null },
        } as Anthropic.Message;
      },
    },
  };
}
