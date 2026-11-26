import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Load the actual Next route handlers with Node 24's TS support and the app alias.
registerHooks({ resolve(name, context, next) {
  if (name.startsWith("@/")) return next(new URL("../" + name.slice(2) + ".ts", import.meta.url).href, context);
  if (name.startsWith("./billing-") && context.parentURL?.endsWith(".ts")) return next(name + ".ts", context);
  return next(name, context);
} });
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "https://pablbrladwjuczhazsms.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture",
  MP_V1_ACCESS_TOKEN: "TEST-fixture", MP_V1_COLLECTOR_ID: "100", MP_V1_APPLICATION_ID: "200",
  MP_V1_WEBHOOK_SECRET: "fixture-secret", VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "fixture.example",
  PRICING_V1_SALES_ENABLED: "true",
});

const contracts = new Map();
const remotes = new Map();
const invoices = new Map();
const expected = { basic: [49,499], pro: [99,999], business: [199,1999] };
let lastPayload;
let resumedAttempt;
const json = (body, status=200) => Response.json(body, {status});

globalThis.fetch = async (input, init = {}) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const body = request.method === "POST" ? await request.json() : null;
  const auth = request.headers.get("authorization");
  const filter = key => url.searchParams.get(key)?.replace(/^eq\./,"");
  if (url.hostname === "pablbrladwjuczhazsms.supabase.co") {
    switch (url.pathname) {
      case "/auth/v1/user": return json({ id: auth === "Bearer other" ? "other" : "admin", email: "fixture@example.test" });
      case "/rest/v1/profiles": return json([{ business_id: filter("id") === "other" ? "other-store" : "store" }]);
      case "/rest/v1/businesses": return json([{ id: filter("id") }]);
      case "/rest/v1/billing_prices": {
        const tier = filter("tier"), m = Number(filter("interval_months"));
        return json({ id: tier + m, tier, interval_months: m, currency: "MXN", vat_included: true,
          amount_cents: expected[tier][Number(m===12)] * 100 });
      }
      case "/rest/v1/rpc/billing_begin": {
        if (resumedAttempt) return json({id:resumedAttempt,create_remote:false});
        const id = randomUUID();
        contracts.set(id,{id,business_id:body.p_business,requested_by:body.p_actor,price_id:body.p_price});
        return json({id,create_remote:true});
      }
      case "/rest/v1/billing_contracts": {
        const row = contracts.get(filter("id"));
        return json(row && row.business_id === filter("business_id") && row.requested_by === filter("requested_by") ? [row] : []);
      }
      case "/rest/v1/rpc/billing_reconcile": {
        const row = contracts.get(body.p_contract);
        if (!row) return json({code:"PT409", message:"Referencia"},409);
        row.provider_id = body.p_provider;
        row.status = body.p_status;
        return json(row.status);
      }
      case "/rest/v1/rpc/billing_record_invoice": invoices.set(body.p_invoice,body); return json(null);
    }
  }
  if (url.hostname === "api.mercadopago.com") {
    assert.equal(auth,"Bearer TEST-fixture");
    if (request.method === "POST" && url.pathname === "/preapproval") {
      lastPayload = body;
      const id = randomUUID().replaceAll("-","");
      const remote = {...body,id,last_modified:"2026-11-24T00:00:00Z",collector_id:100,application_id:200,
        init_point:"https://www.mercadopago.com.mx/subscriptions/checkout?preapproval_id="+id};
      remotes.set(id,remote);
      return json(remote,201);
    }
    if (url.pathname === "/preapproval/search") return json({results:[...remotes.values()]});
    if (url.pathname.startsWith("/preapproval/")) return json(remotes.get(url.pathname.split("/").at(-1)) ?? {},200);
    if (url.pathname === "/authorized_payments/search" && url.searchParams.has("preapproval_id")) {
      return json({results:[{id:123, preapproval_id:url.searchParams.get("preapproval_id")}]});
    }
    if (url.pathname === "/authorized_payments/123") {
      const remote = [...remotes.values()].at(-1);
      return json({id:123,preapproval_id:remote.id,currency_id:"MXN",transaction_amount:remote.auto_recurring.transaction_amount,
        status:"processed",last_modified:"2026-11-24T00:00:00Z", payment:{id:321,status:"approved"}});
    }
    if (url.pathname === "/authorized_payments/search" && url.searchParams.get("payment_id") === "321") {
      return json({results:[await (await fetch("https://api.mercadopago.com/authorized_payments/123",init)).json()]});
    }
  }
  throw new Error("Unexpected fixture request: " + url.pathname);
};
const subscribe = await import("../app/api/mercadopago/subscribe/route.ts");
const confirm = await import("../app/api/mercadopago/v1/confirm/route.ts");
const webhook = await import("../app/api/mercadopago/v1/webhook/route.ts");
const post = (body, actor="admin") => new Request("https://fixture.example", {
  method:"POST",headers:actor ? {Authorization:"Bearer "+actor} : {},body:JSON.stringify(body)
});
function notify(type,id,valid=true) {
  const digest=createHmac("sha256",valid ? "fixture-secret" : "other").update("id:"+id+";request-id:abc;ts:123;").digest("hex");
  return new Request("https://fixture.example/webhook?data.id="+id,{
    method:"POST", headers:{"x-signature":"ts=123,v1="+digest,"x-request-id":"abc"},body:JSON.stringify({type,data:{id}})
  });
}
for (const [plan,prices] of Object.entries(expected)) {
  for (const [index,interval] of ["monthly","annual"].entries()) {
    test(plan+" "+interval+" | checkout, confirmación y notificaciones",async()=>{
      const res = await subscribe.POST(post({plan,interval}));
      const r = await res.json();
      assert.equal(res.status,200,JSON.stringify(r));
      assert.deepEqual(lastPayload.auto_recurring,{frequency:index ? 12 : 1,frequency_type:"months",transaction_amount:prices[index],currency_id:"MXN"});
      assert.equal(lastPayload.back_url,"https://fixture.example/plan?checkout_v1="+r.checkout_id);
      assert.equal(lastPayload.external_reference,"mn-v1:"+r.checkout_id);
      const id = new URL(r.checkout_url).searchParams.get("preapproval_id");
      const remote = remotes.get(id);
      const args={checkout_id:r.checkout_id,preapproval_id:id};
      assert.equal((await (await confirm.POST(post(args))).json()).status,"pending");
      assert.equal((await confirm.POST(post(args,"other"))).status,404);
      remote.status="authorized"; remote.last_modified="2026-11-24T00:01:00Z";
      invoices.clear();
      assert.equal((await webhook.POST(notify("subscription_preapproval",id))).status,200);
      assert.equal(invoices.get("123").p_payment_status,"approved");
      assert.equal(invoices.get("123").p_contract,r.checkout_id);
      assert.equal((await (await confirm.POST(post(args))).json()).status,"authorized");
      assert.equal((await webhook.POST(notify("subscription_authorized_payment","123"))).status,200);
      assert.equal((await webhook.POST(notify("payment","321"))).status,200);
      assert.equal(invoices.get("123").p_cents,prices[index]*100);
    });
  }
}
test("recupera la referencia de un alta sin repetir el POST remoto",async()=>{
  const first = await (await subscribe.POST(post({plan:"pro",interval:"annual"}))).json();
  const count = remotes.size;
  resumedAttempt = first.checkout_id;
  try {
    const second = await (await subscribe.POST(post({plan:"pro",interval:"annual"}))).json();
    assert.equal(second.checkout_url,first.checkout_url);
    assert.equal(second.checkout_id,first.checkout_id);
    assert.equal(remotes.size,count);
  } finally { resumedAttempt = undefined; }
});
test("rechaza notificación sin firma válida, sesión ausente y aplicación ajena",async()=>{
  const remote = [...remotes.values()].at(-1);
  assert.equal((await webhook.POST(notify("subscription_preapproval",remote.id,false))).status,401);
  assert.equal((await subscribe.POST(post({plan:"basic",interval:"annual"},null))).status,401);
  assert.equal((await subscribe.POST(post({plan:"basic",interval:"weekly"}))).status,400);
  remote.application_id=201;
  assert.equal((await webhook.POST(notify("subscription_preapproval",remote.id))).status,409);
  remote.application_id=200;
  remote.collector_id=101;
  assert.equal((await webhook.POST(notify("subscription_preapproval",remote.id))).status,409);
});
test("interruptor de ventas y aislamiento de la base de Preview",async()=>{
  process.env.PRICING_V1_SALES_ENABLED="false";
  assert.equal((await subscribe.POST(post({plan:"basic",interval:"annual"}))).status,503);
  process.env.PRICING_V1_SALES_ENABLED="true";
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://invalid.supabase.co";
  assert.equal((await (await subscribe.GET()).json()).enabled,false);
});
