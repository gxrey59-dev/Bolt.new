/**
 * Binance API Proxy — Cloudflare Worker
 *
 * Forwards authenticated requests to Binance.US, preserving the HMAC
 * signature and X-MBX-APIKEY header the caller already computed.
 *
 * Deploy:
 *   1. npm create cloudflare@latest binance-proxy
 *   2. Copy this file as the worker entry (src/index.js)
 *   3. npx wrangler deploy
 *   4. Set the output URL as BINANCE_PROXY_URL in your Supabase edge function secrets
 *
 * Security: optionally set PROXY_SECRET so only your edge function can call it.
 */

const BINANCE_BASE = "https://api.binance.us";

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-MBX-APIKEY, X-Proxy-Secret",
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    // Optional shared-secret guard
    if (env.PROXY_SECRET) {
      const provided = request.headers.get("X-Proxy-Secret");
      if (provided !== env.PROXY_SECRET) {
        return new Response(JSON.stringify({ error: "Unauthorized proxy request" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const url = new URL(request.url);
    const binanceUrl = `${BINANCE_BASE}${url.pathname}${url.search}`;

    // Forward only the essential headers — don't add browser UA or Content-Type
    // for GET requests, as CloudFront may block bot-like patterns
    const headers = new Headers();
    const apiKey = request.headers.get("X-MBX-APIKEY");
    if (apiKey) headers.set("X-MBX-APIKEY", apiKey);

    // For POST requests, forward the Content-Type and body
    const contentType = request.headers.get("Content-Type");
    if (contentType) headers.set("Content-Type", contentType);

    // Use a minimal, non-browser User-Agent to avoid CloudFront bot detection
    headers.set("User-Agent", "BinanceUS-API-Client/1.0");

    try {
      const fetchOptions = {
        method: request.method,
        headers,
      };

      // Forward request body for POST requests
      if (request.method === "POST") {
        const body = await request.text();
        if (body) {
          fetchOptions.body = body;
        }
      }

      const res = await fetch(binanceUrl, fetchOptions);

      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: {
          ...corsHeaders,
          "Content-Type": res.headers.get("Content-Type") ?? "application/json",
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: `Proxy fetch failed: ${err.message}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
