import { POST as processWebhook } from "@/app/api/mercadopago/v1/webhook/route";

// This deployment exposes only the DEV callback. The canonical handler checks the signature.
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview" ||
      process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://pablbrladwjuczhazsms.supabase.co") {
    return new Response(null, { status: 404 });
  }
  return processWebhook(request);
}
