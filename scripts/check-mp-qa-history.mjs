// Inspect the provider's management API before configuring the dedicated DEV receiver.
const env = process.env;
if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "feature/pricing-v1" ||
    env.NEXT_PUBLIC_SUPABASE_URL !== "https://pablbrladwjuczhazsms.supabase.co" ||
    !env.MP_V1_ACCESS_TOKEN || !/^\d+$/.test(env.MP_V1_APPLICATION_ID ?? "")) {
  throw new Error("Se requiere Preview de facturación con su aplicación de prueba.");
}
const headers = { Authorization: "Bearer " + env.MP_V1_ACCESS_TOKEN };
const get = url => fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(12000) });
const [me, app] = await Promise.all([get("https://api.mercadopago.com/users/me"),
  get("https://api.mercadolibre.com/applications/" + env.MP_V1_APPLICATION_ID)]);
const seller = me.ok ? await me.json() : {};
const application = app.ok ? await app.json() : {};
const testSeller = me.ok && seller.tags?.includes("test_user") && seller.site_id === "MLM" &&
  String(seller.id) === env.MP_V1_COLLECTOR_ID;
const owned = app.ok && String(application.id) === env.MP_V1_APPLICATION_ID &&
  String(application.owner_id) === String(seller.id);
console.log("MP_QA_APP", JSON.stringify({ http: app.status, test_seller: Boolean(testSeller),
  app_matches: app.ok && String(application.id) === env.MP_V1_APPLICATION_ID, owned_by_test_seller: owned }));
if (!testSeller) throw new Error("Revisar la identidad de prueba.");
let session;
async function rpc(method, params, id) {
  const opts = { ...headers, Accept: "application/json, text/event-stream", "Content-Type": "application/json",
    "MCP-Protocol-Version": "2025-03-26" };
  if (session) opts["Mcp-Session-Id"] = session;
  const r = await fetch("https://mcp.mercadopago.com/mcp", { method: "POST", headers: opts,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("Mercado Pago MCP " + method + " HTTP " + r.status);
  if (r.headers.has("mcp-session-id")) session = r.headers.get("mcp-session-id");
  if (id === undefined) return;
  const raw = await r.text();
  const payload = r.headers.get("content-type")?.includes("text/event-stream")
    ? raw.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5))).find(m => m.id === id)
    : JSON.parse(raw);
  if (!payload?.result || payload.error) throw new Error("Mercado Pago MCP rechazó " + method);
  return payload.result;
}
await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mi-negocio-qa", version: "1" } }, 1);
await rpc("notifications/initialized", {});
const { tools } = await rpc("tools/list", {}, 2);
const history = tools.find(t => t.name.replaceAll("-", "_").includes("notifications_history"));
if (!history) throw Error("Historial no disponible");
console.log("QA_HISTORY_SCHEMA", JSON.stringify(history.inputSchema));
