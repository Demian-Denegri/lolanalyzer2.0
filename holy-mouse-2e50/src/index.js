/**
 * Proxy de la Riot Games API para LOL Analyzer.
 *
 * El frontend ya no habla con `*.api.riotgames.com`: le pega a este Worker,
 * que agrega el header `X-Riot-Token` con la key guardada como secreto.
 *
 *   Navegador -> https://<worker>/<region>/<path de riot> -> https://<region>.api.riotgames.com/<path de riot>
 *
 * Ejemplo:
 *   GET https://<worker>/la2/lol/summoner/v4/summoners/by-puuid/XXXX
 *   ->  https://la2.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/XXXX
 *
 * Seguridad:
 * - Solo se permiten los endpoints que la app realmente usa (lista blanca).
 * - La key nunca se devuelve ni se registra en logs.
 * - Rate limit en memoria por IP (best effort) + cache para no quemar la cuota de Riot.
 */

// Regiones de enrutamiento (account-v1 y match-v5).
const ROUTING_REGIONS = new Set(["americas", "asia", "europe", "sea"]);

// Regiones de plataforma (summoner, league, champion-mastery).
const PLATFORM_REGIONS = new Set([
	"br1",
	"eun1",
	"euw1",
	"jp1",
	"kr",
	"la1",
	"la2",
	"na1",
	"oc1",
	"ph2",
	"ru",
	"sg2",
	"th2",
	"tr1",
	"tw2",
	"vn2",
]);

// Lista blanca de endpoints. `ttl` = segundos que se cachea la respuesta.
const ROUTES = [
	// cuenta por Riot ID (gameName/tagLine)
	{ match: /^\/riot\/account\/v1\/accounts\/by-riot-id\/[^/]+\/[^/]+$/, ttl: 300 },
	// cuenta por puuid
	{ match: /^\/riot\/account\/v1\/accounts\/by-puuid\/[^/]+$/, ttl: 3600 },
	// datos del invocador (nivel)
	{ match: /^\/lol\/summoner\/v4\/summoners\/by-puuid\/[^/]+$/, ttl: 3600 },
	// ranked (solo/duo y flex)
	{ match: /^\/lol\/league\/v4\/entries\/by-puuid\/[^/]+$/, ttl: 300 },
	// maestria de campeones
	{
		match:
			/^\/lol\/champion-mastery\/v4\/champion-masteries\/by-puuid\/[^/]+$/,
		ttl: 3600,
	},
	// ids del historial de partidas
	{ match: /^\/lol\/match\/v5\/matches\/by-puuid\/[^/]+\/ids$/, ttl: 300 },
	// detalle de una partida (una partida cerrada ya no cambia)
	{ match: /^\/lol\/match\/v5\/matches\/[^/]+$/, ttl: 86400 },
];

// Query params que se dejan pasar. Cualquier otro se descarta.
const ALLOWED_QUERY_PARAMS = new Set([
	"start",
	"count",
	"queue",
	"type",
	"endTime",
	"beginTime",
	"champion",
]);

const DEFAULT_RATE_LIMIT_MAX = 120; // requests por ventana por IP
const DEFAULT_RATE_LIMIT_WINDOW = 60; // segundos

// Map en memoria por isolate: sirve como freno basico, no como garantia.
const rateBuckets = new Map();

function getCorsOrigin(request, env) {
	const configured = (env.ALLOWED_ORIGINS ?? "*")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);

	const origin = request.headers.get("Origin");
	if (configured.includes("*")) return "*";
	if (origin && configured.includes(origin)) return origin;

	// Sin Origin = llamada server-to-server/curl: no hay politica de CORS que aplicar.
	if (!origin) return null;
	return ""; // origen explicito pero no permitido
}

function corsHeaders(allowOrigin) {
	const headers = {
		"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "86400",
	};
	if (allowOrigin === "*") {
		headers["Access-Control-Allow-Origin"] = "*";
	} else if (allowOrigin) {
		headers["Access-Control-Allow-Origin"] = allowOrigin;
		headers["Vary"] = "Origin";
	}
	return headers;
}

function jsonResponse(payload, status, extraHeaders = {}) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
			...extraHeaders,
		},
	});
}

function clientIp(request) {
	return (
		request.headers.get("CF-Connecting-IP") ??
		request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ??
		"unknown"
	);
}

function isRateLimited(ip, max, windowSeconds) {
	const now = Date.now();
	const windowMs = windowSeconds * 1000;

	// Limpieza barata para que el Map no crezca sin control.
	if (rateBuckets.size > 5000) rateBuckets.clear();

	const bucket = rateBuckets.get(ip);
	if (!bucket || now >= bucket.resetAt) {
		rateBuckets.set(ip, { count: 1, resetAt: now + windowMs });
		return { limited: false, retryAfter: 0 };
	}

	bucket.count += 1;
	if (bucket.count > max) {
		return {
			limited: true,
			retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
		};
	}
	return { limited: false, retryAfter: 0 };
}

function sanitizeSearch(search) {
	const incoming = new URLSearchParams(search);
	const outgoing = new URLSearchParams();
	for (const [key, value] of incoming) {
		if (ALLOWED_QUERY_PARAMS.has(key)) outgoing.set(key, value);
	}
	const result = outgoing.toString();
	return result ? `?${result}` : "";
}

function resolveTarget(pathname) {
	const [, region, ...rest] = pathname.split("/");
	const riotPath = "/" + rest.join("/");

	if (rest.length === 0) return null;
	if (region.includes("..") || riotPath.includes("..")) return null;

	const isRoutingApi =
		riotPath.startsWith("/riot/") || riotPath.startsWith("/lol/match/");
	const isPlatformApi =
		riotPath.startsWith("/lol/summoner/") ||
		riotPath.startsWith("/lol/league/") ||
		riotPath.startsWith("/lol/champion-mastery/");

	if (isRoutingApi && !ROUTING_REGIONS.has(region)) return null;
	if (isPlatformApi && !PLATFORM_REGIONS.has(region)) return null;
	if (!isRoutingApi && !isPlatformApi) return null;

	const route = ROUTES.find((candidate) => candidate.match.test(riotPath));
	if (!route) return null;

	return { region, riotPath, ttl: route.ttl };
}

async function handleRiotProxy(request, env, url) {
	// 1) Validar contra la lista blanca
	const target = resolveTarget(url.pathname);
	if (!target) {
		return jsonResponse(
			{ error: "Endpoint no permitido por el proxy." },
			404,
		);
	}

	// 2) Verificar que exista el secreto
	if (!env.RIOT_API_KEY) {
		console.error("Falta el secreto RIOT_API_KEY en el Worker.");
		return jsonResponse(
			{ error: "El proxy no tiene configurada la API key de Riot." },
			500,
		);
	}

	// 3) Rate limit por IP
	const max = Number(env.RATE_LIMIT_MAX ?? DEFAULT_RATE_LIMIT_MAX);
	const windowSeconds = Number(
		env.RATE_LIMIT_WINDOW ?? DEFAULT_RATE_LIMIT_WINDOW,
	);
	const limit = isRateLimited(clientIp(request), max, windowSeconds);
	if (limit.limited) {
		return jsonResponse(
			{ error: "Demasiadas peticiones. Intenta de nuevo en unos segundos." },
			429,
			{ "Retry-After": String(limit.retryAfter) },
		);
	}

	const riotUrl =
		`https://${target.region}.api.riotgames.com${target.riotPath}` +
		sanitizeSearch(url.search);

	const cache = caches.default; // Cache de Cloudflare Workers
	const cacheKey = new Request(riotUrl, { method: "GET" });
	const useCache = target.ttl > 0;

	if (useCache) {
		const cached = await cache.match(cacheKey);
		if (cached) {
			const hit = new Response(cached.body, cached);
			hit.headers.set("X-Proxy-Cache", "HIT");
			return hit;
		}
	}

	let riotResponse;
	try {
		riotResponse = await fetch(riotUrl, {
			method: "GET",
			headers: {
				"X-Riot-Token": env.RIOT_API_KEY,
				Accept: "application/json",
			},
		});
	} catch (error) {
		console.error("Error de red contra Riot:", error);
		return jsonResponse(
			{ error: "No se pudo contactar la API de Riot." },
			502,
		);
	}

	// Riot devolvio error: se reenvia el status sin exponer nada sensible.
	if (!riotResponse.ok) {
		const body = await riotResponse.text();
		return new Response(body, {
			status: riotResponse.status,
			headers: {
				"Content-Type":
					riotResponse.headers.get("Content-Type") ??
					"application/json; charset=utf-8",
				"X-Content-Type-Options": "nosniff",
				"Cache-Control": "no-store",
			},
		});
	}

	const headers = new Headers(riotResponse.headers);
	headers.set("Cache-Control", `public, max-age=${target.ttl}`);
	headers.set("X-Proxy-Cache", "MISS");
	headers.delete("Set-Cookie");

	const response = new Response(riotResponse.body, {
		status: riotResponse.status,
		headers,
	});

	if (useCache) {
		try {
			// Se guarda una copia: el body original se consume al responder.
			await cache.put(cacheKey, response.clone());
		} catch (error) {
			console.error("No se pudo guardar en cache:", error);
		}
	}

	return response;
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const allowOrigin = getCorsOrigin(request, env);

		// Origen no permitido: se corta antes de tocar Riot.
		if (allowOrigin === "") {
			return jsonResponse({ error: "Origen no permitido." }, 403);
		}

		const cors = corsHeaders(allowOrigin);

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: cors });
		}

		if (request.method !== "GET" && request.method !== "HEAD") {
			return jsonResponse(
				{ error: "Metodo no permitido." },
				405,
				{ ...cors, Allow: "GET, HEAD, OPTIONS" },
			);
		}

		if (url.pathname === "/" || url.pathname === "/health") {
			return jsonResponse(
				{ ok: true, hasApiKey: Boolean(env.RIOT_API_KEY) },
				200,
				cors,
			);
		}

		const response = await handleRiotProxy(request, env, url);
		const withCors = new Response(response.body, response);
		for (const [key, value] of Object.entries(cors)) {
			withCors.headers.set(key, value);
		}
		return withCors;
	},
};
