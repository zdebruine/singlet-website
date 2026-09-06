// Shared MCP config snippets used by /docs, /docs/mcp and /quickstart.
export const MCP_URL = "https://singlet.bio/mcp";

/** With no key: search runs at the 10/day anonymous allowance, everything else is free. */
export const claudeDesktopConfigNoKey = `{
  "mcpServers": {
    "singlet": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${MCP_URL}"]
    }
  }
}`;

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

export const cursorConfigNoKey = `{
  "mcpServers": {
    "singlet": { "url": "${MCP_URL}" }
  }
}`;

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

export const claudeCodeConfigNoKey = `claude mcp add --transport http singlet ${MCP_URL}`;

export function vscodeConfig(key: string): string {
  return `{
  "servers": {
    "singlet": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": { "Authorization": "Bearer ${key}" }
    }
  }
}`;
}
