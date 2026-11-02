import { mcpConfig } from "../server/mcp/common.js";
import { createMcpApp } from "../server/mcp/handler.js";
export default {
  fetch(request: Request) {
    return createMcpApp(mcpConfig(process.env))(request);
  },
};
