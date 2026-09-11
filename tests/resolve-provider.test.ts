import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BRIDGE_VERSION,
  MCP_PROVIDERS,
  groupedTools,
  providerForCapability,
  toolCatalogText,
} from "@/lib/mcp-providers";

const bridgeSource = readFileSync("bridge/orby-bridge.mjs", "utf8");
const resolve = MCP_PROVIDERS.davinci_resolve;

describe("resolve provider registry", () => {
  it("is reachable from its chat capability key", () => {
    expect(providerForCapability("davinci_resolve")?.id).toBe("davinci_resolve");
    expect(providerForCapability("nope")).toBeUndefined();
  });

  it("keeps the bridge version in step with the helper script", () => {
    expect(bridgeSource).toContain(`const BRIDGE_VERSION = "${BRIDGE_VERSION}"`);
    // The embedded Python worker carries the same version.
    expect(bridgeSource).toContain(`BRIDGE_VERSION = "${BRIDGE_VERSION}"\n`);
  });

  it("has a unique, non-empty command catalogue", () => {
    const names = resolve.tools.map((t) => t.name);
    expect(names.length).toBeGreaterThan(50);
    expect(new Set(names).size).toBe(names.length);
    for (const t of resolve.tools) {
      expect(t.description.trim()).not.toBe("");
      expect(t.example.trim()).not.toBe("");
      expect(resolve.groups).toContain(t.group);
    }
  });

  it("groups every command and numbers them from one", () => {
    const groups = groupedTools(resolve);
    const numbered = groups.flatMap((g) => g.tools.map((t) => t.n));
    expect(numbered.sort((a, b) => a - b)).toEqual(resolve.tools.map((_, i) => i + 1));
    expect(toolCatalogText(resolve)).toContain(resolve.tools[0]!.name);
  });

  it("every catalogue command is actually handled by the local helper", () => {
    const missing = resolve.tools.filter((t) => !bridgeSource.includes(`"${t.name}"`));
    expect(missing.map((t) => t.name)).toEqual([]);
  });

  it("offers a read-only check command the helper understands", () => {
    const cmd = resolve.checkCommand();
    expect(cmd).toContain("/api/public/mcp-bridge/install");
    expect(cmd).toMatch(/orby-bridge\.mjs check$/);
    // No pairing code and nothing that writes to Resolve.
    expect(cmd).not.toContain("connect");
    expect(bridgeSource).toContain('["connect", "run", "check"]');
  });

  it("builds a pairing command that carries the code", () => {
    expect(resolve.installCommand("ABC12345")).toMatch(/connect ABC12345$/);
  });

  it("never shadows a worker helper with a local variable", () => {
    // A local named after a helper makes it local for the whole function in Python,
    // which caused "local variable 'folder' referenced before assignment".
    const helpers = [
      ...bridgeSource.matchAll(/^def ([a-z_]+)\(/gm),
    ].map((m) => m[1]!);
    expect(helpers).toContain("folder");
    const shadowing: string[] = [];
    for (const line of bridgeSource.split("\n")) {
      const m = /^\s+([a-z_]+)\s*(?:,\s*[a-z_]+\s*)*=[^=]/.exec(line);
      if (m && helpers.includes(m[1]!)) shadowing.push(line.trim());
    }
    expect(shadowing).toEqual([]);
  });

  it("tells the user Studio is required and where the setting lives", () => {
    const text = [...resolve.checklist, ...resolve.troubleshooting.map((t) => `${t.problem} ${t.fix}`)].join(" ");
    expect(text).toMatch(/Studio/);
    expect(text).toMatch(/External scripting/);
    expect(text).toMatch(/21\.1/);
  });
});
