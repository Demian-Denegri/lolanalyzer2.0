import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, vi, afterEach } from "vitest";
import worker from "../src";

const testEnv = { ...env, RIOT_API_KEY: "fake-test-secret", ALLOWED_ORIGINS: "*" };

async function callWorker(url, init = {}, envOverrides = {}) {
	const request = new Request(url, init);
	const ctx = createExecutionContext();
	const response = await worker.fetch(
		request,
		{ ...testEnv, ...envOverrides },
		ctx,
	);
	await waitOnExecutionContext(ctx);
	return response;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("proxy de Riot", () => {
	it("responde el health sin exponer la key", async () => {
		const response = await callWorker("https://proxy.test/health");
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toEqual({ ok: true, hasApiKey: true });
		expect(JSON.stringify(body)).not.toContain("fake-test-secret");
	});

	it("rechaza endpoints fuera de la lista blanca", async () => {
		const response = await callWorker(
			"https://proxy.test/la2/lol/status/v4/platform-data",
		);
		expect(response.status).toBe(404);
	});

	it("rechaza regiones desconocidas", async () => {
		const response = await callWorker(
			"https://proxy.test/evil/lol/summoner/v4/summoners/by-puuid/abc",
		);
		expect(response.status).toBe(404);
	});

	it("no permite POST", async () => {
		const response = await callWorker(
			"https://proxy.test/la2/lol/summoner/v4/summoners/by-puuid/abc",
			{ method: "POST" },
		);
		expect(response.status).toBe(405);
	});

	it("reenvia a Riot con el token y devuelve CORS", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({ puuid: "abc", summonerLevel: 30 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const response = await callWorker(
			"https://proxy.test/la2/lol/summoner/v4/summoners/by-puuid/abc",
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [riotUrl, riotInit] = fetchMock.mock.calls[0];
		expect(riotUrl).toBe(
			"https://la2.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/abc",
		);
		expect(riotInit.headers["X-Riot-Token"]).toBe("fake-test-secret");
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(await response.json()).toEqual({ puuid: "abc", summonerLevel: 30 });
	});

	it("usa americas para match-v5 y conserva la query permitida", async () => {
		const fetchMock = vi.fn(async () => Response.json([]));
		vi.stubGlobal("fetch", fetchMock);

		await callWorker(
			"https://proxy.test/americas/lol/match/v5/matches/by-puuid/abc/ids?start=0&count=20&foo=bar",
		);

		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/abc/ids?start=0&count=20",
		);
	});

	it("propaga el status de error de Riot", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({ status: { status_code: 404 } }, { status: 404 }),
			),
		);

		const response = await callWorker(
			"https://proxy.test/la2/lol/league/v4/entries/by-puuid/abc",
		);
		expect(response.status).toBe(404);
	});

	it("bloquea origenes no permitidos cuando hay lista", async () => {
		const response = await callWorker(
			"https://proxy.test/health",
			{ headers: { Origin: "https://otro-sitio.com" } },
			{ ALLOWED_ORIGINS: "https://mi-app.pages.dev" },
		);
		expect(response.status).toBe(403);
	});

	it("responde el preflight", async () => {
		const response = await callWorker("https://proxy.test/health", {
			method: "OPTIONS",
		});
		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
			"GET",
		);
	});
});
