/**
 * SERVER-ONLY, pure. Non-secret diagnosis of DATABASE_URL and of a database connection error (#39 ops).
 *
 * NEVER returns, logs or echoes the URL, the password, the user name or any raw error message. What it reports:
 *   - the URL's SHAPE: host kind (Supabase pooler / direct / other), port, the pooler host label (e.g.
 *     "aws-0-eu-central-1", it carries the region, which is what "Tenant or user not found" usually points at),
 *     whether the user looks like "postgres.<ref>" (what the pooler needs) or plain "postgres", database name shape;
 *   - booleans for the usual paste mistakes: a placeholder password, surrounding quotes, surrounding whitespace or a
 *     newline, a URL that fails to parse, characters in the password that needed URL-encoding, sslmode present;
 *   - for an error: a short CLASS only (an errno / SQLSTATE code, or a fixed label), from an allowlisted shape.
 */

export type HostKind = "pooler" | "direct" | "other";
export type UserShape = "postgres.<ref>" | "postgres" | "other" | "missing";

export interface DbUrlDiagnostic {
  /** The URL could not be parsed (after trimming and stripping one pair of quotes). */
  parseFailed: boolean;
  scheme: "postgresql" | "postgres" | "other" | null;
  hostKind: HostKind | null;
  /** e.g. "aws-0-eu-central-1" for a pooler host; null otherwise. Region only, no project or credentials. */
  poolerHost: string | null;
  port: number | null;
  userShape: UserShape | null;
  /** The database path is "/postgres". */
  databaseIsPostgres: boolean | null;
  passwordPresent: boolean | null;
  /** The password contains "YOUR-PASSWORD" or square brackets (the Supabase Connect placeholder). */
  placeholderPassword: boolean;
  /** The raw value was wrapped in matching '…' or "…" (stripped before connecting). */
  surroundingQuotes: boolean;
  /** The raw value had leading/trailing whitespace or a newline (trimmed before connecting). */
  surroundingWhitespace: boolean;
  /** The raw password section contains characters that must be percent-encoded (@ # / ? : space and so on). */
  passwordNeedsEncoding: boolean;
  sslmode: boolean;
}

/** Trim, then strip ONE pair of matching surrounding quotes, then trim again. What the client connects with. */
export function normalizeDatabaseUrl(raw: string | undefined | null): string {
  let s = (raw ?? "").trim();
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s.at(-1) === s[0]) s = s.slice(1, -1).trim();
  return s;
}

/** The raw "user:password" section: between "://" and the LAST "@" before the host (null if absent). */
function rawUserInfo(s: string): string | null {
  const start = s.indexOf("://");
  if (start < 0) return null;
  const rest = s.slice(start + 3);
  const at = rest.lastIndexOf("@");
  return at < 0 ? null : rest.slice(0, at);
}

export function diagnoseDatabaseUrl(raw: string): DbUrlDiagnostic {
  const trimmed = raw.trim();
  const surroundingWhitespace = trimmed !== raw;
  const surroundingQuotes = trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.at(-1) === trimmed[0];
  const s = normalizeDatabaseUrl(raw);
  const userInfo = rawUserInfo(s);
  const colon = userInfo ? userInfo.indexOf(":") : -1;
  const rawPassword = userInfo && colon >= 0 ? userInfo.slice(colon + 1) : null;
  const placeholderPassword = rawPassword !== null && /YOUR-PASSWORD|[[\]]/i.test(decodeSafe(rawPassword));
  // Anything outside the URL "userinfo" safe set (unreserved, sub-delims, %XX) needed encoding.
  const passwordNeedsEncoding = rawPassword !== null && /[^A-Za-z0-9\-._~!$&'()*+,;=%]|%(?![0-9A-Fa-f]{2})/.test(rawPassword);
  const base = { placeholderPassword, surroundingQuotes, surroundingWhitespace, passwordNeedsEncoding };

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return {
      ...base,
      parseFailed: true,
      scheme: null,
      hostKind: null,
      poolerHost: null,
      port: null,
      userShape: null,
      databaseIsPostgres: null,
      passwordPresent: rawPassword !== null ? rawPassword.length > 0 : null,
      sslmode: /[?&]sslmode=/i.test(s),
    };
  }
  const host = u.hostname.toLowerCase();
  const hostKind: HostKind = /\.pooler\.supabase\.com$/.test(host) ? "pooler" : /^db\.[a-z0-9]+\.supabase\.co$/.test(host) ? "direct" : "other";
  const label = hostKind === "pooler" ? host.split(".")[0] : null;
  const user = decodeSafe(u.username);
  const userShape: UserShape = !user ? "missing" : /^postgres\.[a-z0-9]{10,40}$/.test(user) ? "postgres.<ref>" : user === "postgres" ? "postgres" : "other";
  const scheme = u.protocol === "postgresql:" ? "postgresql" : u.protocol === "postgres:" ? "postgres" : "other";
  return {
    ...base,
    parseFailed: false,
    scheme,
    hostKind,
    poolerHost: label && /^[a-z0-9-]{1,40}$/.test(label) ? label : null,
    port: u.port ? Number(u.port) : null,
    userShape,
    databaseIsPostgres: u.pathname === "/postgres",
    passwordPresent: u.password.length > 0,
    sslmode: u.searchParams.has("sslmode"),
  };
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Fixed labels, by message, for errors with no usable code (or the catch-all XX000). Never the message itself. */
const MESSAGE_CLASSES: [RegExp, string][] = [
  [/tenant or user not found/i, "XX000 Tenant or user not found"],
  [/password authentication failed/i, "28P01"],
  [/database .* does not exist/i, "3D000"],
  [/CONNECT_TIMEOUT/i, "CONNECT_TIMEOUT"],
  [/self[- ]signed certificate|certificate|ssl|tls/i, "SSL error"],
  [/getaddrinfo/i, "DNS error"],
  [/invalid url|failed to parse/i, "URL parse error"],
];
const SQLSTATE_LABELS: Record<string, string> = {
  "28P01": "28P01",
  "3D000": "3D000",
};

/**
 * The connection error CLASS: an errno / driver / SQLSTATE code (ENOTFOUND, ETIMEDOUT, ECONNREFUSED, ENETUNREACH,
 * CONNECT_TIMEOUT, 28P01, 3D000, ...); "XX000 Tenant or user not found" (Supabase's pooler, for a wrong user shape or
 * region); "timeout" for the health probe's own timer. Never the raw message (it can carry the host or user).
 */
export function classifyDbError(e: unknown): string {
  // Drizzle wraps driver errors ("Failed query: ...", the driver error as `cause`); Node can raise an AggregateError
  // (several addresses tried). Classify the innermost error that carries a code, else the innermost one.
  const chain: unknown[] = [];
  for (let cur: unknown = e, i = 0; cur && i < 6; i++) {
    chain.push(cur);
    const c = cur as { cause?: unknown; errors?: unknown };
    cur = c.cause ?? (Array.isArray(c.errors) ? c.errors[0] : undefined);
  }
  const withCode = [...chain].reverse().find((x) => typeof (x as { code?: unknown }).code === "string");
  return classifyOne(withCode ?? chain.at(-1) ?? e);
}

function classifyOne(e: unknown): string {
  const err = (e ?? {}) as { code?: unknown; name?: unknown; message?: unknown };
  const code = typeof err.code === "string" && /^[A-Z0-9_]{2,40}$/.test(err.code) ? err.code : null;
  const message = typeof err.message === "string" ? err.message : "";
  if (code && code !== "XX000") return SQLSTATE_LABELS[code] ?? code;
  if (!code && message === "timeout") return "timeout";
  for (const [re, label] of MESSAGE_CLASSES) if (re.test(message)) return label;
  if (code) return code;
  return typeof err.name === "string" && /^[A-Za-z]{2,40}$/.test(err.name) ? err.name : "Error";
}
