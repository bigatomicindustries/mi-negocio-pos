import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const EXPECTED_MP_COLLECTOR_ID = process.env.MERCADOPAGO_COLLECTOR_ID;
const EXPECTED_MP_APPLICATION_ID = process.env.MERCADOPAGO_APPLICATION_ID;

export async function POST(request: Request) {
  try {
    if (
      !MERCADOPAGO_ACCESS_TOKEN || !EXPECTED_MP_COLLECTOR_ID || !EXPECTED_MP_APPLICATION_ID ||
      !SUPABASE_URL ||
      !SUPABASE_ANON_KEY
    ) {
      console.error("Falta configuración del servidor");

      return NextResponse.json(
        { error: "Configuración incompleta del servidor" },
        { status: 500 }
      );
    }

    // ---------------------------------------------------------
    // 1. AUTENTICAR AL USUARIO
    // ---------------------------------------------------------

    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 401 }
      );
    }

    const accessToken = authorization.slice(7);

    const supabaseAuth = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json(
        { error: "Sesión inválida" },
        { status: 401 }
      );
    }

    // ---------------------------------------------------------
    // 2. LEER PREAPPROVAL_ID
    // ---------------------------------------------------------

    const body = await request.json().catch(() => null);

    const preapprovalId =
      typeof body?.preapproval_id === "string"
        ? body.preapproval_id.trim()
        : "";

        const checkoutId =
  typeof body?.checkout_id === "string"
    ? body.checkout_id.trim()
    : "";

    if (!preapprovalId) {
      return NextResponse.json(
        { error: "Falta preapproval_id" },
        { status: 400 }
      );
    }

    // Validación básica del formato.
    if (!/^[a-zA-Z0-9_-]{10,100}$/.test(preapprovalId)) {
      return NextResponse.json(
        { error: "preapproval_id inválido" },
        { status: 400 }
      );
    }

if (
  checkoutId &&
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    checkoutId
  )
) {
  return NextResponse.json(
    { error: "checkout_id inválido" },
    { status: 400 }
  );
}

    // ---------------------------------------------------------
    // 3. OBTENER PERFIL DEL USUARIO
    // ---------------------------------------------------------

    const { data: profile, error: profileError } =
      await supabaseAdmin
        .from("profiles")
        .select("id, business_id, role, active")
        .eq("id", user.id)
        .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "Perfil no encontrado" },
        { status: 403 }
      );
    }

    if (!profile.active || profile.role !== "admin") {
      return NextResponse.json(
        { error: "No tienes permisos para administrar la suscripción" },
        { status: 403 }
      );
    }

    // ---------------------------------------------------------
    // 4. VALIDAR NEGOCIO
    // ---------------------------------------------------------

    const { data: business, error: businessError } =
      await supabaseAdmin
        .from("businesses")
        .select("id, active")
        .eq("id", profile.business_id)
        .maybeSingle();

    if (businessError || !business || !business.active) {
      return NextResponse.json(
        { error: "Negocio no disponible" },
        { status: 403 }
      );
    }

    // ---------------------------------------------------------
    // 5. CONSULTAR LA SUSCRIPCIÓN DIRECTAMENTE EN MERCADO PAGO
    // ---------------------------------------------------------

    const mpResponse = await fetch(
      `https://api.mercadopago.com/preapproval/${encodeURIComponent(
        preapprovalId
      )}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    const mpSubscription = await mpResponse.json().catch(() => null);

    if (!mpResponse.ok || !mpSubscription) {
      console.error(
        "No se pudo consultar preapproval en Mercado Pago:",
        mpResponse.status
      );

      return NextResponse.json(
        { error: "No pudimos verificar la suscripción con Mercado Pago" },
        { status: 400 }
      );
    }

    // ---------------------------------------------------------
    // 6. VALIDACIONES AUTORITATIVAS DE MERCADO PAGO
    // ---------------------------------------------------------

    if (mpSubscription.id !== preapprovalId) {
      return NextResponse.json(
        { error: "La suscripción recibida no coincide" },
        { status: 400 }
      );
    }

    if (mpSubscription.status !== "authorized") {
      return NextResponse.json(
        {
          error: "La suscripción todavía no está autorizada",
          status: mpSubscription.status ?? null,
        },
        { status: 409 }
      );
    }

    if (
      String(mpSubscription.collector_id) !== EXPECTED_MP_COLLECTOR_ID ||
      String(mpSubscription.application_id) !== EXPECTED_MP_APPLICATION_ID
    ) {
      console.error("Preapproval pertenece a otra cuenta/aplicación");

      return NextResponse.json(
        { error: "La suscripción no pertenece a esta aplicación" },
        { status: 403 }
      );
    }

    const mercadoPagoPlanId =
      typeof mpSubscription.preapproval_plan_id === "string"
        ? mpSubscription.preapproval_plan_id
        : "";

    if (!mercadoPagoPlanId) {
      return NextResponse.json(
        { error: "La suscripción no tiene un plan asociado" },
        { status: 400 }
      );
    }

    // ---------------------------------------------------------
    // 7. ENCONTRAR EL PLAN INTERNO
    // ---------------------------------------------------------

    const { data: internalPlan, error: internalPlanError } =
      await supabaseAdmin
        .from("plans")
        .select(
          "id, name, slug, active, mercadopago_plan_id, price_monthly, currency"
        )
        .eq("mercadopago_plan_id", mercadoPagoPlanId)
        .eq("active", true)
        .maybeSingle();

    if (internalPlanError || !internalPlan) {
      return NextResponse.json(
        { error: "El plan de Mercado Pago no está registrado" },
        { status: 400 }
      );
    }

    if (internalPlan.slug === "free") {
      return NextResponse.json(
        { error: "Plan inválido para una suscripción de pago" },
        { status: 400 }
      );
    }

    // ---------------------------------------------------------
    // 8. EVITAR QUE EL MISMO PREAPPROVAL SEA RECLAMADO
    //    POR OTRO NEGOCIO
    // ---------------------------------------------------------

    const { data: existingClaim, error: existingClaimError } =
      await supabaseAdmin
        .from("subscription_checkouts")
        .select("id, business_id, plan_id, mercadopago_subscription_id")
        .eq("mercadopago_subscription_id", preapprovalId)
        .maybeSingle();

    if (existingClaimError) {
      console.error(
        "Error comprobando preapproval existente:",
        existingClaimError
      );

      return NextResponse.json(
        { error: "No pudimos validar la operación" },
        { status: 500 }
      );
    }

    if (
      existingClaim &&
      existingClaim.business_id !== business.id
    ) {
      return NextResponse.json(
        { error: "Esta suscripción ya está vinculada a otro negocio" },
        { status: 409 }
      );
    }

// ============================================================
// 9. RESOLVER EL CHECKOUT LOCAL
// ============================================================

type SubscriptionCheckout = {
  id: string;
  business_id: string;
  plan_id: string;
  requested_by: string;
  mercadopago_subscription_id: string | null;
  mercadopago_status: string;
  payer_email: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

let checkout: SubscriptionCheckout | null = null;

// ------------------------------------------------------------
// 9A. SI TENEMOS CHECKOUT_ID, USAMOS EL CHECKOUT EXACTO
// ------------------------------------------------------------

if (checkoutId) {
  const { data, error } = await supabaseAdmin
    .from("subscription_checkouts")
    .select(
      `
      id,
      business_id,
      plan_id,
      requested_by,
      mercadopago_subscription_id,
      mercadopago_status,
      payer_email,
      created_at,
      updated_at,
      expires_at
      `
    )
    .eq("id", checkoutId)
    .maybeSingle();

  if (error) {
    console.error(
      "Error buscando checkout exacto:",
      error.message
    );

    return NextResponse.json(
      { error: "No se pudo validar el intento de suscripción" },
      { status: 500 }
    );
  }

  checkout = data as SubscriptionCheckout | null;

  if (!checkout) {
    return NextResponse.json(
      { error: "El intento de suscripción no existe" },
      { status: 404 }
    );
  }
}

// ------------------------------------------------------------
// 9B. SI SE PERDIÓ CHECKOUT_ID, RECUPERARLO DE FORMA CONTROLADA
// ------------------------------------------------------------

else {
  const nowIso = new Date().toISOString();

  const { data: candidates, error } = await supabaseAdmin
    .from("subscription_checkouts")
    .select(
      `
      id,
      business_id,
      plan_id,
      requested_by,
      mercadopago_subscription_id,
      mercadopago_status,
      payer_email,
      created_at,
      updated_at,
      expires_at
      `
    )
    .eq("business_id", business.id)
    .eq("requested_by", user.id)
    .eq("plan_id", internalPlan.id)
    .eq("mercadopago_status", "pending")
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(2);

  if (error) {
    console.error(
      "Error recuperando checkout pendiente:",
      error.message
    );

    return NextResponse.json(
      { error: "No se pudo validar el intento de suscripción" },
      { status: 500 }
    );
  }

  if (!candidates || candidates.length === 0) {
    return NextResponse.json(
      {
        error:
          "No encontramos un intento de suscripción vigente para este pago",
      },
      { status: 404 }
    );
  }

  // Nunca elegimos arbitrariamente entre varios intentos.
  if (candidates.length !== 1) {
    return NextResponse.json(
      {
        error:
          "Encontramos más de un intento de suscripción vigente. No podemos determinar cuál corresponde a este pago.",
      },
      { status: 409 }
    );
  }

  checkout = candidates[0] as SubscriptionCheckout;
}

// ------------------------------------------------------------
// 9C. VALIDACIONES DEL CHECKOUT RESUELTO
// ------------------------------------------------------------

if (!checkout) {
  return NextResponse.json(
    { error: "No se pudo resolver el intento de suscripción" },
    { status: 404 }
  );
}

if (
  !checkout.expires_at ||
  new Date(checkout.expires_at).getTime() <= Date.now()
) {
  return NextResponse.json(
    { error: "El intento de suscripción ha expirado" },
    { status: 409 }
  );
}

// El checkout debe pertenecer al negocio autenticado.
if (checkout.business_id !== business.id) {
  return NextResponse.json(
    { error: "El intento de suscripción no pertenece a este negocio" },
    { status: 403 }
  );
}

// El checkout debe haber sido iniciado por este mismo usuario.
if (checkout.requested_by !== user.id) {
  return NextResponse.json(
    { error: "El intento de suscripción no pertenece a este usuario" },
    { status: 403 }
  );
}

// El plan solicitado localmente debe coincidir con el plan
// que Mercado Pago confirmó realmente.
if (checkout.plan_id !== internalPlan.id) {
  return NextResponse.json(
    { error: "El plan del intento de suscripción no coincide" },
    { status: 409 }
  );
}

// Solo permitimos un checkout pendiente o el mismo checkout
// que ya haya sido autorizado anteriormente.
if (
  checkout.mercadopago_status !== "pending" &&
  checkout.mercadopago_subscription_id !== preapprovalId
) {
  return NextResponse.json(
    { error: "Este intento de suscripción ya fue utilizado" },
    { status: 409 }
  );
}

// Si ya tiene un preapproval asociado, solamente puede ser éste mismo.
if (
  checkout.mercadopago_subscription_id &&
  checkout.mercadopago_subscription_id !== preapprovalId
) {
  return NextResponse.json(
    {
      error:
        "Este intento de suscripción ya está vinculado a otra suscripción",
    },
    { status: 409 }
  );
}

    // ---------------------------------------------------------
    // 10. VINCULAR EL PREAPPROVAL AL CHECKOUT
    // ---------------------------------------------------------

 const {
  data: checkoutActualizado,
  error: checkoutUpdateError,
} = await supabaseAdmin
  .from("subscription_checkouts")
  .update({
    mercadopago_subscription_id: preapprovalId,
    mercadopago_status: mpSubscription.status,
    updated_at: new Date().toISOString(),
  })
  .eq("id", checkout.id)
  .eq("business_id", business.id)
  .select("id")
  .maybeSingle();

if (checkoutUpdateError) {
  console.error(
    "Error vinculando checkout:",
    checkoutUpdateError
  );

  return NextResponse.json(
    { error: "No pudimos vincular la suscripción" },
    { status: 500 }
  );
}

if (!checkoutActualizado) {
  console.error(
    "El checkout no fue actualizado:",
    checkout.id
  );

  return NextResponse.json(
    { error: "No pudimos vincular la suscripción" },
    { status: 409 }
  );
}

    // ---------------------------------------------------------
// 10B. VALIDAR LA SUSCRIPCIÓN ACTUAL DEL NEGOCIO
// ---------------------------------------------------------

const {
  data: currentSubscription,
  error: currentSubscriptionError,
} = await supabaseAdmin
  .from("subscriptions")
  .select("id, status, mercadopago_subscription_id")
  .eq("business_id", business.id)
  .maybeSingle();

if (currentSubscriptionError || !currentSubscription) {
  console.error(
    "Error obteniendo suscripción actual:",
    currentSubscriptionError
  );

  return NextResponse.json(
    { error: "No pudimos validar la suscripción actual" },
    { status: 500 }
  );
}

// Si ya existe otra suscripción de Mercado Pago asociada,
// solamente permitimos reemplazarla si la anterior está cancelada.
if (
  currentSubscription.mercadopago_subscription_id &&
  currentSubscription.mercadopago_subscription_id !== preapprovalId &&
  currentSubscription.status !== "cancelled"
) {
  return NextResponse.json(
    {
      error:
        "El negocio ya tiene otra suscripción de Mercado Pago activa",
    },
    { status: 409 }
  );
}

    // ---------------------------------------------------------
    // 11. ACTUALIZAR LA SUSCRIPCIÓN INTERNA DEL NEGOCIO
    // ---------------------------------------------------------

    const nextPaymentDate =
      typeof mpSubscription.next_payment_date === "string"
        ? mpSubscription.next_payment_date
        : null;

const {
  data: suscripcionActualizada,
  error: subscriptionUpdateError,
} = await supabaseAdmin
  .from("subscriptions")
  .update({
    plan_id: internalPlan.id,
    status: "active",
    mercadopago_subscription_id: preapprovalId,
    mercadopago_plan_id: mercadoPagoPlanId,
    mercadopago_payer_email:
      typeof mpSubscription.payer_email === "string" &&
      mpSubscription.payer_email.trim()
        ? mpSubscription.payer_email.trim()
        : null,
    current_period_ends_at: nextPaymentDate,
    updated_at: new Date().toISOString(),
  })
  .eq("business_id", business.id)
  .eq("id", currentSubscription.id)
  .select("id")
  .maybeSingle();

if (subscriptionUpdateError) {
  console.error(
    "Error actualizando suscripción interna:",
    subscriptionUpdateError
  );

  return NextResponse.json(
    { error: "No pudimos activar el plan" },
    { status: 500 }
  );
}

if (!suscripcionActualizada) {
  console.error(
    "La suscripción interna no fue actualizada:",
    currentSubscription.id
  );

  return NextResponse.json(
    { error: "No pudimos activar el plan" },
    { status: 409 }
  );
}

    // ---------------------------------------------------------
    // 12. RESPUESTA
    // ---------------------------------------------------------

    return NextResponse.json({
      success: true,
      plan: {
        id: internalPlan.id,
        name: internalPlan.name,
        slug: internalPlan.slug,
      },
      subscription: {
        status: "active",
        current_period_ends_at: nextPaymentDate,
      },
    });
  } catch (error) {
    console.error("Error confirmando suscripción:", error);

    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}