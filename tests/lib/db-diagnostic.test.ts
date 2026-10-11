/** #39 ops: DATABASE_URL shape diagnosis and error classes. All URLs here are fake. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDb, DbConfigError, getDb } from "@/db/client";
import { closedGamesRepo, dbHealthReport, logDbFailure } from "@/lib/closed-games";
import { classifyDbError, diagnoseDatabaseUrl, normalizeDatabaseUrl } from "@/lib/db-diagnostic";

const REF = "abcdefghijklmnopqrst";
const PW = "s3cretFakePw";
const POOLER = `postgresql://postgres.${REF}:${PW}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`;
const DIRECT = `postgresql://postgres:${PW}@db.${REF}.supabase.co:5432/postgres`;
const noSecrets = (o: unknown) => {
  const s = JSON.stringify(o);
  for (const bad of [PW, REF, "supabase.com", "supabase.co", "@"]) expect(s, bad).not.toContain(bad);
  expect(s).not.toMatch(/postgres\.(?!<ref>)/);
};

describe("normalizeDatabaseUrl", () => {
  it("trims, and strips ONE pair of matching quotes", () => {
    expect(normalizeDatabaseUrl(`  ${POOLER}\n`)).toBe(POOLER);
    expect(normalizeDatabaseUrl(`"${POOLER}"`)).toBe(POOLER);
    expect(normalizeDatabaseUrl(` '${POOLER}' \n`)).toBe(POOLER);
    expect(normalizeDatabaseUrl(`"'${POOLER}'"`)).toBe(`'${POOLER}'`);
    expect(normalizeDatabaseUrl(`"${POOLER}'`)).toBe(`"${POOLER}'`); // not a matching pair
    expect(normalizeDatabaseUrl(undefined)).toBe("");
  });
});

describe("diagnoseDatabaseUrl", () => {
  it("the right string: transaction pooler, 6543, postgres.<ref>, nothing wrong", () => {
    const d = diagnoseDatabaseUrl(POOLER);
    expect(d).toEqual({
      parseFailed: false,
      scheme: "postgresql",
      hostKind: "pooler",
      poolerHost: "aws-0-eu-central-1",
      port: 6543,
      userShape: "postgres.<ref>",
      databaseIsPostgres: true,
      passwordPresent: true,
      placeholderPassword: false,
      surroundingQuotes: false,
      surroundingWhitespace: false,
      passwordNeedsEncoding: false,
      sslmode: false,
    });
    noSecrets(d);
  });
  it("the direct host (IPv6-only from Vercel) with plain postgres user", () => {
    const d = diagnoseDatabaseUrl(DIRECT);
    expect(d).toMatchObject({ hostKind: "direct", port: 5432, userShape: "postgres", poolerHost: null });
    noSecrets(d);
  });
  it("session pooler port, sslmode, other hosts", () => {
    expect(diagnoseDatabaseUrl(POOLER.replace(":6543", ":5432") + "?sslmode=require")).toMatchObject({ hostKind: "pooler", port: 5432, sslmode: true });
    expect(diagnoseDatabaseUrl("postgres://u:p@localhost/db")).toMatchObject({ hostKind: "other", port: null, scheme: "postgres", databaseIsPostgres: false, userShape: "other" });
  });
  it("the Supabase Connect placeholder, bracketed or not", () => {
    expect(diagnoseDatabaseUrl(POOLER.replace(PW, "[YOUR-PASSWORD]")).placeholderPassword).toBe(true);
    expect(diagnoseDatabaseUrl(POOLER.replace(PW, "YOUR-PASSWORD")).placeholderPassword).toBe(true);
    expect(diagnoseDatabaseUrl(POOLER.replace(PW, "[hunter2]")).placeholderPassword).toBe(true);
    expect(diagnoseDatabaseUrl(POOLER).placeholderPassword).toBe(false);
  });
  it("quotes, whitespace and a newline", () => {
    const d = diagnoseDatabaseUrl(` "${POOLER}"\n`);
    expect(d).toMatchObject({ surroundingQuotes: true, surroundingWhitespace: true, parseFailed: false, hostKind: "pooler" });
    noSecrets(d);
    expect(diagnoseDatabaseUrl(`'${POOLER}'`)).toMatchObject({ surroundingQuotes: true, surroundingWhitespace: false });
  });
  it("an unencoded special character in the password, and a URL that fails to parse", () => {
    const bad = POOLER.replace(PW, "pa#ss/word");
    const d = diagnoseDatabaseUrl(bad);
    expect(d.passwordNeedsEncoding).toBe(true);
    noSecrets(d);
    expect(diagnoseDatabaseUrl(POOLER.replace(PW, encodeURIComponent("pa#ss/word"))).passwordNeedsEncoding).toBe(false);
    const broken = diagnoseDatabaseUrl(`postgresql://postgres.${REF}:${PW}@:not a host:99999/x`);
    expect(broken).toMatchObject({ parseFailed: true, hostKind: null, port: null, userShape: null });
    noSecrets(broken);
    expect(diagnoseDatabaseUrl("not a url").parseFailed).toBe(true);
  });
});

describe("classifyDbError", () => {
  const err = (props: Record<string, unknown>) => Object.assign(new Error(String(props.message ?? "x")), props);
  it.each([
    [{ code: "ENOTFOUND", message: `getaddrinfo ENOTFOUND db.${REF}.supabase.co` }, "ENOTFOUND"],
    [{ code: "ETIMEDOUT", message: "connect ETIMEDOUT 1.2.3.4:5432" }, "ETIMEDOUT"],
    [{ code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.1:9" }, "ECONNREFUSED"],
    [{ code: "ENETUNREACH", message: "connect ENETUNREACH 2a05::1:5432" }, "ENETUNREACH"],
    [{ code: "CONNECT_TIMEOUT", message: "write CONNECT_TIMEOUT aws-0-x.pooler.supabase.com:6543" }, "CONNECT_TIMEOUT"],
    [{ code: "28P01", message: `password authentication failed for user "postgres.${REF}"` }, "28P01"],
    [{ code: "3D000", message: 'database "nope" does not exist' }, "3D000"],
    [{ code: "XX000", message: "Tenant or user not found" }, "XX000 Tenant or user not found"],
    [{ code: "XX000", message: `something else about ${PW}` }, "XX000"],
    [{ message: "Tenant or user not found" }, "XX000 Tenant or user not found"],
    [{ message: "timeout" }, "timeout"],
    [{ code: "DEPTH_ZERO_SELF_SIGNED_CERT", message: "self-signed certificate" }, "DEPTH_ZERO_SELF_SIGNED_CERT"],
    [{ message: "self signed certificate in certificate chain" }, "SSL error"],
    [{ code: "URL_PARSE_ERROR" }, "URL_PARSE_ERROR"],
    [{ code: `lower-case ${PW}`, message: POOLER }, "Error"],
  ])("%j -> %s", (props, cls) => {
    const c = classifyDbError(err(props));
    expect(c).toBe(cls);
    noSecrets(c);
  });
  it("unwraps Drizzle's query error (cause) and AggregateError", () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED" });
    expect(classifyDbError(Object.assign(new Error("Failed query: select 1"), { cause: inner }))).toBe("ECONNREFUSED");
    expect(classifyDbError(new AggregateError([inner], "x"))).toBe("ECONNREFUSED");
    expect(classifyDbError(Object.assign(new Error("Failed query"), { cause: new Error("Tenant or user not found") }))).toBe("XX000 Tenant or user not found");
  });
  it("non-errors", () => {
    expect(classifyDbError(undefined)).toBe("Error");
    expect(classifyDbError("boom")).toBe("Error");
  });
});

describe("wiring: health report, the log line, and connecting with the normalized URL", () => {
  const prev = process.env.DATABASE_URL;
  afterEach(async () => {
    await closeDb();
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
    vi.restoreAllMocks();
  });

  it("unreachable: the report carries the shape and the class; one log line with neither URL nor password", async () => {
    const env = { DATABASE_URL: ` "${POOLER}"\n` } as unknown as NodeJS.ProcessEnv;
    const lines: string[] = [];
    const r = await dbHealthReport({ env, ping: () => Promise.reject(Object.assign(new Error("Tenant or user not found"), { code: "XX000" })), log: (l) => lines.push(l) });
    expect(r).toEqual({ db: "unreachable", dbDiagnostic: expect.objectContaining({ hostKind: "pooler", port: 6543, surroundingQuotes: true, surroundingWhitespace: true, errorClass: "XX000 Tenant or user not found" }) });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[db\] \{"event":"db_unreachable","source":"health",/);
    noSecrets(r);
    noSecrets(lines[0].replace("[db] ", ""));
  });
  it("ok: the shape with errorClass null; unconfigured: no diagnostic at all", async () => {
    expect(await dbHealthReport({ env: { DATABASE_URL: POOLER } as unknown as NodeJS.ProcessEnv, ping: async () => 1 })).toEqual({ db: "ok", dbDiagnostic: expect.objectContaining({ errorClass: null, hostKind: "pooler" }) });
    expect(await dbHealthReport({ env: {} as unknown as NodeJS.ProcessEnv })).toEqual({ db: "unconfigured" });
  });
  it("the real client connects with the trimmed, unquoted URL (a refused local port, not a parse error)", async () => {
    const env = { DATABASE_URL: ` 'postgres://nobody:${PW}@127.0.0.1:9/none'\n` } as unknown as NodeJS.ProcessEnv;
    const lines: string[] = [];
    const r = await dbHealthReport({ env, log: (l) => lines.push(l) });
    expect(r.db).toBe("unreachable");
    expect(r.dbDiagnostic?.errorClass).toBe("ECONNREFUSED");
    expect(lines.join("\n")).not.toContain(PW);
  });
  it("a URL the driver can't parse: getDb throws a bare DbConfigError; accusations fail CLOSED (the repo rejects)", async () => {
    const env = { DATABASE_URL: `postgres://u:${PW}@[::1` } as unknown as NodeJS.ProcessEnv;
    let thrown: unknown;
    try {
      getDb(env);
    } catch (e) {
      thrown = e;
    }
    if (thrown) {
      expect(thrown).toBeInstanceOf(DbConfigError);
      expect(String((thrown as Error).message)).not.toContain(PW);
    }
    const errs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((l: string) => void errs.push(l));
    const repo = closedGamesRepo(env, () => {});
    expect(repo).not.toBeNull();
    await expect(repo!.closeGame({ gameId: "g", caseId: "c", outcome: "won", accusedId: null })).rejects.toBeDefined();
    expect(errs.join("\n")).not.toContain(PW);
    const h = await dbHealthReport({ env, log: () => {} });
    expect(h.db).toBe("unreachable");
  });
  it("logDbFailure never prints the URL", () => {
    const lines: string[] = [];
    logDbFailure("accuse", Object.assign(new Error(`connect to ${POOLER} failed`), { code: "ECONNRESET" }), { DATABASE_URL: POOLER } as unknown as NodeJS.ProcessEnv, (l) => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0].slice(5))).toMatchObject({ event: "db_unreachable", source: "accuse", errorClass: "ECONNRESET", hostKind: "pooler" });
    noSecrets(lines[0].slice(5));
  });
});
