import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ActionCtx } from "../actions/types.js";
import { getActions, getAction } from "../actions/registry.js";
import { actionArgsJsonSchema } from "../actions/schema.js";
import { executeAction, ActionError } from "../actions/guard.js";

export function buildMcpServer(actx: ActionCtx): Server {
  const server = new Server(
    { name: "sovetnik-actions", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  const visible = () => getActions(actx.menu);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visible().map<Tool>((a) => ({
      name: a.name,
      description:
        `${a.humanTitle}. ${a.description}` +
        (a.mutates ? " [изменяет данные]" : "") +
        (a.requiresUI ? " [требует UI/бинарный ввод]" : ""),
      inputSchema: actionArgsJsonSchema(a) as Tool["inputSchema"],
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const action = getAction(name);
    if (!action || !visible().some((a) => a.name === name)) {
      return { isError: true, content: [{ type: "text", text: `Неизвестное или недоступное действие: ${name}` }] };
    }
    try {
      const result = await executeAction(action, actx, req.params.arguments ?? {});
      return { content: [{ type: "text", text: JSON.stringify(result.data) }] };
    } catch (err) {
      const msg = err instanceof ActionError || err instanceof Error ? err.message : "Ошибка выполнения действия";
      return { isError: true, content: [{ type: "text", text: msg }] };
    }
  });

  return server;
}
