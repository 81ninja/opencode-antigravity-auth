import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadManagedProject, ensureProjectContext, invalidateProjectContextCache } from "./project";
import { ANTIGRAVITY_ENDPOINT_PROD, ANTIGRAVITY_DEFAULT_PROJECT_ID } from "../constants";
import type { OAuthAuthDetails } from "./types";

function mockFetchResponse(status: number, payload: unknown, url?: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const inputUrl = String(input);
    if (url && inputUrl !== url) {
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function makeAuth(refresh = "refresh-token-abc"): OAuthAuthDetails {
  return { type: "oauth", refresh, access: "access-token-xyz" };
}

const LOAD_CODE_ASSIST_PROJECT = "dark-connection-d4z76";

describe("loadManagedProject", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the CLI identity body and headers (no vscode/Client-Metadata)", async () => {
    const fetchMock = mockFetchResponse(200, { allowedTiers: [] });
    await loadManagedProject("access-token");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(input).toBe(`${ANTIGRAVITY_ENDPOINT_PROD}/v1internal:loadCodeAssist`);

    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^antigravity\/cli\/\d+\.\d+\.\d+ \(aidev_client/);
    expect(headers["Authorization"]).toBe("Bearer access-token");
    expect(headers["X-Goog-Api-Client"]).toBeUndefined();
    expect(headers["Client-Metadata"]).toBeUndefined();

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ metadata: { ideType: "ANTIGRAVITY" } });
  });

  it("returns the parsed payload on success", async () => {
    const payload = { cloudaicompanionProject: LOAD_CODE_ASSIST_PROJECT, allowedTiers: [] };
    mockFetchResponse(200, payload);
    const result = await loadManagedProject("access-token");
    expect(result).toEqual(payload);
  });

  it("returns null when all endpoints fail", async () => {
    mockFetchResponse(500, {});
    const result = await loadManagedProject("access-token");
    expect(result).toBeNull();
  });
});

describe("ensureProjectContext", () => {
  beforeEach(() => {
    invalidateProjectContextCache();
  });
  afterEach(() => {
    invalidateProjectContextCache();
    vi.unstubAllGlobals();
  });

  it("resolves the managed project from loadCodeAssist and persists it", async () => {
    mockFetchResponse(200, {
      cloudaicompanionProject: LOAD_CODE_ASSIST_PROJECT,
      allowedTiers: [{ id: "free-tier", isDefault: true }],
    });

    const result = await ensureProjectContext(makeAuth());
    expect(result.effectiveProjectId).toBe(LOAD_CODE_ASSIST_PROJECT);
    expect(result.auth.refresh).toContain(LOAD_CODE_ASSIST_PROJECT);
    expect(result.auth.refresh.startsWith("refresh-token-abc")).toBe(true);
  });

  it("reuses an existing managed project id from the refresh token", async () => {
    const fetchMock = mockFetchResponse(200, {});
    const auth = makeAuth(`refresh-token-abc||${LOAD_CODE_ASSIST_PROJECT}`);
    const result = await ensureProjectContext(auth);
    expect(result.effectiveProjectId).toBe(LOAD_CODE_ASSIST_PROJECT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the default project id when loadCodeAssist fails", async () => {
    mockFetchResponse(500, {});
    const result = await ensureProjectContext(makeAuth());
    expect(result.effectiveProjectId).toBe(ANTIGRAVITY_DEFAULT_PROJECT_ID);
  });
});
