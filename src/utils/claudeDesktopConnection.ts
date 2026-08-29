function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;

  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet))
  );
}

/**
 * Claude Desktop only permits plaintext HTTP for loopback gateways. Public and
 * LAN HTTP endpoints therefore have to be reached through 302 Switch's local
 * Claude Desktop gateway, even when no protocol or model-name conversion is
 * otherwise needed.
 */
export function requiresClaudeDesktopLocalRoute(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    return url.protocol === "http:" && !isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}
