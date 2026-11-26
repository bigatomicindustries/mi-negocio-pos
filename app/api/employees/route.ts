import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type RolEmpleado = "admin" | "manager" | "cashier";

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Falta configuración de Supabase en el servidor." },
        { status: 500 }
      );
    }

    // 1. Obtener el token del usuario que está haciendo la petición
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "No autorizado." },
        { status: 401 }
      );
    }

    const accessToken = authorization.slice(7);

    // 2. Cliente normal para verificar quién está haciendo la petición
    const supabaseAuth = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json(
        { error: "Sesión inválida." },
        { status: 401 }
      );
    }

    // 3. Verificar el perfil y rol del usuario autenticado
const { data: perfil, error: perfilError } = await supabaseAuth
  .from("profiles")
  .select("id, role, active, business_id")
  .eq("id", user.id)
  .single();

    if (perfilError || !perfil) {
      return NextResponse.json(
        { error: "No se pudo verificar tu perfil." },
        { status: 403 }
      );
    }

    if (!perfil.active || perfil.role !== "admin") {
      return NextResponse.json(
        { error: "Solo un administrador activo puede crear empleados." },
        { status: 403 }
      );
    }

    const trial = await supabaseAuth.rpc("my_trial_end");
    if (trial.error || (trial.data && Date.parse(trial.data) <= Date.now())) {
      return NextResponse.json({ error: "Verifica la vigencia del plan antes de crear empleados." }, { status: 403 });
    }
    if (!perfil.business_id) {
  return NextResponse.json(
    { error: "Tu usuario no tiene un negocio asignado." },
    { status: 403 }
  );
}

const {
  data: negocio,
  error: negocioError,
} = await supabaseAuth
  .from("businesses")
  .select("id, active")
  .eq("id", perfil.business_id)
  .single();

if (
  negocioError ||
  !negocio ||
  !negocio.active
) {
  return NextResponse.json(
    {
      error:
        "El negocio está suspendido o no está disponible.",
    },
    { status: 403 }
  );
}

    // 4. Leer y validar los datos del nuevo empleado
    const body = await request.json();

    const fullName =
      typeof body.full_name === "string"
        ? body.full_name.trim()
        : "";

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    const password =
      typeof body.password === "string"
        ? body.password
        : "";

    const role = body.role as RolEmpleado;

    const branchIds = Array.isArray(body.branch_ids)
  ? [
      ...new Set(
        body.branch_ids.filter(
          (id: unknown): id is string =>
            typeof id === "string" &&
            id.trim().length > 0
        )
      ),
    ]
  : [];

    if (!fullName) {
      return NextResponse.json(
        { error: "El nombre es obligatorio." },
        { status: 400 }
      );
    }

    if (!email) {
      return NextResponse.json(
        { error: "El correo es obligatorio." },
        { status: 400 }
      );
    }

    if (!email.includes("@")) {
      return NextResponse.json(
        { error: "Ingresa un correo válido." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "La contraseña debe tener al menos 8 caracteres." },
        { status: 400 }
      );
    }

    if (!["admin", "manager", "cashier"].includes(role)) {
      return NextResponse.json(
        { error: "Rol no válido." },
        { status: 400 }
      );
    }

if (branchIds.length === 0) {
  return NextResponse.json(
    {
      error:
        "Selecciona al menos una sucursal para el empleado.",
    },
    { status: 400 }
  );
}

    // 5. Cliente administrativo.
    // Esta clave vive solamente en el servidor.
    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );


const {
  data: sucursalesValidas,
  error: sucursalesError,
} = await supabaseAdmin
  .from("branches")
  .select("id")
  .eq("business_id", perfil.business_id)
  .eq("active", true)
  .in("id", branchIds);

if (sucursalesError) {
  console.error(
    "Error validando sucursales:",
    sucursalesError
  );

  return NextResponse.json(
    {
      error:
        "No se pudieron validar las sucursales seleccionadas.",
    },
    { status: 500 }
  );
}

if (
  !sucursalesValidas ||
  sucursalesValidas.length !== branchIds.length
) {
  return NextResponse.json(
    {
      error:
        "Una o más sucursales seleccionadas no son válidas.",
    },
    { status: 400 }
  );
}
    // =====================================================
// 6. VERIFICAR LÍMITE DE USUARIOS DEL PLAN
// =====================================================

const {
  data: suscripcion,
  error: suscripcionError,
} = await supabaseAdmin
  .from("subscriptions")
  .select(`
    id,
    status,
    plans (
      id,
      name,
      slug,
      max_users
    )
  `)
  .eq("business_id", perfil.business_id)
  .single();

if (suscripcionError || !suscripcion) {
  console.error(
    "Error obteniendo suscripción:",
    suscripcionError
  );

  return NextResponse.json(
    {
      error:
        "No se pudo verificar la suscripción del negocio.",
    },
    { status: 403 }
  );
}

if (
  !["active", "trialing", "past_due"].includes(
    suscripcion.status
  )
) {
  return NextResponse.json(
    {
      error:
        "La suscripción del negocio no permite crear usuarios.",
    },
    { status: 403 }
  );
}

const plan = Array.isArray(suscripcion.plans)
  ? suscripcion.plans[0]
  : suscripcion.plans;

if (!plan) {
  return NextResponse.json(
    {
      error:
        "No se pudo verificar el plan del negocio.",
    },
    { status: 403 }
  );
}

const {
  count: usuariosActuales,
  error: usuariosError,
} = await supabaseAdmin
  .from("profiles")
  .select("id", {
    count: "exact",
    head: true,
  })
  .eq("business_id", perfil.business_id);

if (usuariosError) {
  console.error(
    "Error contando usuarios:",
    usuariosError
  );

  return NextResponse.json(
    {
      error:
        "No se pudo verificar el límite de usuarios.",
    },
    { status: 500 }
  );
}

const totalUsuarios =
  usuariosActuales ?? 0;

if (totalUsuarios >= plan.max_users) {
  return NextResponse.json(
    {
      error:
        `Tu plan ${plan.name} permite un máximo de ${plan.max_users} usuarios.`,
      code: "USER_LIMIT_REACHED",
      limit: plan.max_users,
      current: totalUsuarios,
    },
    { status: 403 }
  );
}

    // 7. Crear la cuenta en Supabase Auth
    const {
      data: nuevoUsuario,
      error: crearUsuarioError,
    } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
    });

    if (crearUsuarioError || !nuevoUsuario.user) {
      console.error(
        "Error creando usuario:",
        crearUsuarioError
      );

      return NextResponse.json(
        {
          error:
            crearUsuarioError?.message ||
            "No se pudo crear el usuario.",
        },
        { status: 400 }
      );
    }

    const nuevoUsuarioId = nuevoUsuario.user.id;

    // 7. Crear o completar su perfil
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
.upsert(
  {
    id: nuevoUsuarioId,
    full_name: fullName,
    role,
    active: true,

    // El tenant SIEMPRE sale del admin autenticado.
    business_id: perfil.business_id,

    updated_at: new Date().toISOString(),
  },
        {
          onConflict: "id",
        }
      );

    if (profileError) {
      console.error(
        "Error creando perfil:",
        profileError
      );

      // Evitamos dejar un usuario huérfano en Auth.
      await supabaseAdmin.auth.admin.deleteUser(
        nuevoUsuarioId
      );

      return NextResponse.json(
        { error: "No se pudo crear el perfil del empleado." },
        { status: 500 }
      );
    }

const asignaciones = branchIds.map(
  (branchId) => ({
    profile_id: nuevoUsuarioId,
    branch_id: branchId,
    business_id: perfil.business_id,
  })
);

const { error: branchesError } =
  await supabaseAdmin
    .from("profile_branches")
    .insert(asignaciones);

if (branchesError) {
  console.error(
    "Error asignando sucursales:",
    branchesError
  );

  // Evitamos dejar datos incompletos.
  await supabaseAdmin
    .from("profiles")
    .delete()
    .eq("id", nuevoUsuarioId);

  await supabaseAdmin.auth.admin.deleteUser(
    nuevoUsuarioId
  );

  return NextResponse.json(
    {
      error:
        "No se pudieron asignar las sucursales al empleado.",
    },
    { status: 500 }
  );
}

    // 8. Respuesta segura: nunca devolvemos la contraseña.
    return NextResponse.json(
      {
employee: {
  id: nuevoUsuarioId,
  full_name: fullName,
  email,
  role,
  active: true,
  branch_ids: branchIds,
},
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creando empleado:", error);

    return NextResponse.json(
      { error: "Ocurrió un error al crear el empleado." },
      { status: 500 }
    );
  }
}