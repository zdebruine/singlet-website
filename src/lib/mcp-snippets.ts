export const MCP_URL = "https://singlet.bio/mcp";

export function claudeDesktopConfig(key: string): string {
  return `{
  "mcpServers": {
    "singlet": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "${MCP_URL}",
        "--header", "Authorization: Bearer ${key}"
      ]
    }
  }
}`;
}

export function cursorConfig(key: string): string {
  return `{
  "mcpServers": {
    "singlet": {
      "url": "${MCP_URL}",
      "headers": { "Authorization": "Bearer ${key}" }
    }
  }
}`;
}

export function claudeCodeConfig(key: string): string {
  return `claude mcp add --transport http singlet ${MCP_URL} \\
  --header "Authorization: Bearer ${key}"`;
}
