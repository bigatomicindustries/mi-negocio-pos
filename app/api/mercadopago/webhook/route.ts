import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function validarFirmaWebhook(
  xSignature: string,
  xRequestId: string,
  dataId: string,
  secret: string
) {
  let ts = "";
  let v1 = "";

  for (const parte of xSignature.split(",")) {
    const [clave, valor] = parte.split("=", 2);

    if (clave?.trim() === "ts") {
      ts = valor?.trim() ?? "";
    }

    if (clave?.trim() === "v1") {
      v1 = valor?.trim() ?? "";
    }
  }

  if (!ts || !v1) {
    return false;
  }

  const manifest =
    `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const firmaEsperada = crypto
    .createHmac("sha256", secret)
    .update(manifest)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(firmaEsperada, "hex"),
      Buffer.from(v1, "hex")
    );
  } catch {
    return false;
  }
}

function mapearEstadoMercadoPago(
  status: string | undefined
): "active" | "past_due" | "cancelled" | null {
  switch (status) {
    case "authorized":
      return "active";

    case "paused":
      return "past_due";

    case "cancelled":
      return "cancelled";

    default:
      return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const secret =
      process.env.MERCADOPAGO_WEBHOOK_SECRET;

    const accessToken =
      process.env.MERCADOPAGO_ACCESS_TOKEN;

      const collectorId =
  process.env.MERCADOPAGO_COLLECTOR_ID;

  const applicationId =
  process.env.MERCADOPAGO_APPLICATION_ID;

if (
  !secret ||
  !accessToken ||
  !collectorId ||
  !applicationId
) {
      console.error(
        "Falta configuración de Mercado Pago"
      );

      return NextResponse.json(
        { error: "Configuración incompleta" },
        { status: 500 }
      );
    }

    const xSignature =
      request.headers.get("x-signature");

    const xRequestId =
      request.headers.get("x-request-id");

    const dataId =
      request.nextUrl.searchParams.get("data.id") ??
      request.nextUrl.searchParams.get("id");

    if (!xSignature || !xRequestId || !dataId) {
      console.error("Webhook incompleto", {
        tieneFirma: Boolean(xSignature),
        tieneRequestId: Boolean(xRequestId),
        dataId,
      });

      return NextResponse.json(
        { error: "Notificación incompleta" },
        { status: 400 }
      );
    }

    // 1. Validar firma de Mercado Pago

    const firmaValida =
      validarFirmaWebhook(
        xSignature,
        xRequestId,
        dataId,
        secret
      );

    if (!firmaValida) {
      console.error(
        "Firma de Mercado Pago inválida"
      );

      return NextResponse.json(
        { error: "Firma inválida" },
        { status: 401 }
      );
    }

    // 2. Leer notificación

    const body =
      await request.json().catch(() => null);

    console.log(
      "Webhook Mercado Pago VALIDADO:",
      {
        type: body?.type,
        action: body?.action,
        dataId,
        liveMode: body?.live_mode,
        notificationId: body?.id,
      }
    );

    // 3. Por ahora solamente nos interesan
    // las suscripciones.
    //
    // Otros eventos se reconocen y se ignoran.

    if (body?.type !== "subscription_preapproval") {
      console.log(
        "Webhook ignorado: no es subscription_preapproval"
      );

      return NextResponse.json(
        {
          received: true,
          ignored: true,
        },
        { status: 200 }
      );
    }

    // 4. Consultar directamente a Mercado Pago.
    //
    // IMPORTANTE:
    // No confiamos en el body del webhook para
    // determinar el estado real de la suscripción.

    const mpResponse = await fetch(
      `https://api.mercadopago.com/preapproval/${encodeURIComponent(
        dataId
      )}`,
      {
        method: "GET",
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

if (!mpResponse.ok) {
  const errorText =
    await mpResponse.text();

  console.error(
    "No se pudo consultar el preapproval:",
    {
      status: mpResponse.status,
      dataId,
      response:
        errorText.slice(0, 500),
    }
  );

  // Si Mercado Pago está limitado o tiene un fallo
  // temporal, devolvemos 503 para NO confirmar que
  // procesamos correctamente la notificación.
  //
  // Esto permite que la notificación pueda
  // reintentarse posteriormente.

  if (
    mpResponse.status === 429 ||
    mpResponse.status >= 500
  ) {
    return NextResponse.json(
      {
        error:
          "Mercado Pago temporalmente no disponible",
      },
      { status: 503 }
    );
  }

  // Para errores permanentes del recurso
  // (por ejemplo, un preapproval inexistente),
  // reconocemos la notificación pero no hacemos
  // ningún cambio en Supabase.

  return NextResponse.json(
    {
      received: true,
      ignored: true,
      reason: "preapproval_lookup_failed",
    },
    { status: 200 }
  );
}

    const preapproval =
      await mpResponse.json();

    if (preapproval?.id !== dataId ||
        String(preapproval.collector_id) !== collectorId ||
        String(preapproval.application_id) !== applicationId) {
      return NextResponse.json({ received: true, ignored: true, reason: "account_or_resource_mismatch" });
    }

const {
  data: suscripcionLocal,
  error: errorSuscripcion,
} = await supabaseAdmin
  .from("subscriptions")
  .select(
    "id, business_id, plan_id, status, mercadopago_subscription_id, mercadopago_plan_id"
  )
  .eq("mercadopago_subscription_id", preapproval.id)
  .maybeSingle();

if (errorSuscripcion) {
  console.error(
    "Error buscando suscripción local:",
    errorSuscripcion
  );

  return NextResponse.json(
    { error: "Error consultando suscripción" },
    { status: 500 }
  );
}

if (!suscripcionLocal) {
  console.log(
    "Webhook ignorado: suscripción no registrada localmente",
    {
      mercadopagoSubscriptionId: preapproval.id,
    }
  );

  return NextResponse.json(
    {
      received: true,
      ignored: true,
      reason: "subscription_not_found",
    },
    { status: 200 }
  );
}

// 6. Validar que el plan de Mercado Pago
// coincide con el registrado localmente.

if (
  !preapproval?.preapproval_plan_id ||
  !suscripcionLocal.mercadopago_plan_id ||
  preapproval.preapproval_plan_id !==
    suscripcionLocal.mercadopago_plan_id
) {
  console.error(
    "Webhook rechazado: el plan de Mercado Pago no coincide",
    {
      mercadopagoSubscriptionId: preapproval.id,
      planRecibido: preapproval?.preapproval_plan_id,
      planRegistrado:
        suscripcionLocal.mercadopago_plan_id,
    }
  );

  return NextResponse.json(
    {
      received: true,
      ignored: true,
      reason: "plan_mismatch",
    },
    { status: 200 }
  );
}

// 7. Traducir el estado de Mercado Pago
// a nuestro estado interno.

const estadoInterno =
  mapearEstadoMercadoPago(preapproval?.status);

if (!estadoInterno) {
  console.log(
    "Webhook ignorado: estado de Mercado Pago no reconocido",
    {
      mercadopagoSubscriptionId: preapproval.id,
      status: preapproval?.status,
    }
  );

  return NextResponse.json(
    {
      received: true,
      ignored: true,
      reason: "unsupported_status",
    },
    { status: 200 }
  );
}

// 8. Actualizar el estado de la suscripción local.
//
// El filtro por ID local + ID de Mercado Pago hace
// que únicamente podamos modificar la suscripción
// que ya validamos anteriormente.

const {
  data: suscripcionActualizada,
  error: errorActualizacion,
} = await supabaseAdmin
  .from("subscriptions")
  .update({
    status: estadoInterno,
    updated_at: new Date().toISOString(),
  })
  .eq("id", suscripcionLocal.id)
  .eq(
    "mercadopago_subscription_id",
    preapproval.id
  )
  .select("id")
  .maybeSingle();

if (errorActualizacion) {
  console.error(
    "Error actualizando suscripción desde webhook:",
    errorActualizacion
  );

  return NextResponse.json(
    { error: "Error actualizando suscripción" },
    { status: 500 }
  );
}

if (!suscripcionActualizada) {
  console.error(
    "Webhook no actualizó ninguna suscripción",
    {
      subscriptionId: suscripcionLocal.id,
      mercadopagoSubscriptionId:
        preapproval.id,
    }
  );

  return NextResponse.json(
    {
      error:
        "La suscripción no pudo ser actualizada",
    },
    { status: 500 }
  );
}

console.log(
  "Suscripción actualizada desde Mercado Pago:",
  {
    subscriptionId: suscripcionLocal.id,
    businessId: suscripcionLocal.business_id,
    estadoAnterior: suscripcionLocal.status,
    estadoNuevo: estadoInterno,
    mercadopagoSubscriptionId: preapproval.id,
  }
);


return Response.json(
  {
    ok: true,
    updated: true,
    subscriptionId: suscripcionLocal.id,
    status: estadoInterno,
  },
  { status: 200 }
);

    // 5. DIAGNÓSTICO TEMPORAL
    //
    // Mostramos únicamente campos útiles.
    // No mostramos tokens ni datos de tarjeta.
    // NO escribimos nada en Supabase.

    console.log(
      "PREAPPROVAL REAL DE MERCADO PAGO:",
      {
        id:
          preapproval?.id,

        status:
          preapproval?.status,

        preapproval_plan_id:
          preapproval?.preapproval_plan_id,

        external_reference:
          preapproval?.external_reference,

        collector_id:
          preapproval?.collector_id,

        application_id:
          preapproval?.application_id,

        payer_id:
          preapproval?.payer_id,

        reason:
          preapproval?.reason,

        date_created:
          preapproval?.date_created,

        last_modified:
          preapproval?.last_modified,

        next_payment_date:
          preapproval?.next_payment_date,

        back_url:
          preapproval?.back_url,
      }
    );

    // TODAVÍA NO:
    //
    // - actualizamos subscription_checkouts
    // - actualizamos subscriptions
    // - cambiamos plan_id
    // - activamos Pro/Business
    //
    // Primero observaremos una suscripción sandbox real.
  }
catch (error) {
    console.error(
      "Error procesando webhook Mercado Pago:",
      error
    );

    return NextResponse.json(
      { error: "Error procesando webhook" },
      { status: 500 }
    );
  }
}