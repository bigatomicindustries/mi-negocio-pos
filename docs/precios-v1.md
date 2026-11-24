# Mi Negocio POS · Contratación v1

## Tarifas aprobadas

Cada importe incluye IVA. El anual se cobra completo cada doce meses.

| Plan | Mensual MXN | Anual MXN |
|---|---:|---:|
| Básico | $49 | $499 |
| Pro | $99 | $999 |
| Business | $199 | $1,999 |

## Qué se publica

El navegador elige plan e intervalo. El servidor autentica al administrador, comprueba el negocio activo y coteja el catálogo de Supabase con el precio mostrado. Los importes se almacenan como centavos enteros. El rol de la aplicación solo puede leer las tarifas. Para cambiar un precio se agrega una versión y se conserva la fila contratada.

Cada alta crea una suscripción individual pendiente mediante `POST /preapproval`. La referencia externa identifica un contrato local. El retorno a `/plan` y el webhook consultan la API con credenciales del servidor y pasan por la misma transacción. Se comprueban vendedor, aplicación, referencia, moneda, importe y frecuencia. Se acepta la actualización más reciente según la versión de Mercado Pago. La autorización activa el plan. Las cuotas y su estado de pago se registran por separado con su identificador de factura. Una autorización por sí sola no acredita una cuota.

La migración agrega tres planes operativos con identificadores distintos. Básico hereda los límites POS de Free en esta etapa (2 usuarios, 100 productos, 1 sucursal). Pro y Business toman los límites POS existentes (10/5,000/1 y 50/50,000/3). Los límites de CRM y la política de prueba/suspensión corresponden a etapas posteriores. Los registros de suscripción existentes conservan sus IDs, importes y condiciones. La contratación v1 acepta el paso voluntario desde Free o desde un contrato cancelado. Bloquea la sustitución de un contrato vigente, incluso si fue asignado manualmente.

## Verificación del 24 de noviembre de 2026

- Mi Negocio DEV, proyecto `pablbrladwjuczhazsms`. Las migraciones `pricing_v1_contracts` y `pricing_v1_lookup_indexes` están en el historial. Las seis filas coinciden con los importes aprobados.
- La huella de todas las columnas de las suscripciones existentes coincidió antes y después. La prueba SQL usa un negocio y usuario efímeros, ejecuta el ciclo como `service_role` y termina con `ROLLBACK`. Al verificar quedaron cero contratos y cero cuotas de prueba.
- La prueba SQL cubre las seis combinaciones, rechazo de importes, monedas e intervalos distintos, usuario ajeno, conservación de contratos anteriores, reintento de checkout, autorización, pausa, cancelación y cuotas duplicadas. Verifica los permisos efectivos de `anon`, `authenticated` y `service_role`.
- Pruebas de las rutas con transporte simulado. Cubren la solicitud saliente, el regreso del navegador, los tres tópicos de webhook, los identificadores ajenos, la firma incorrecta, el interruptor de ventas y el aislamiento de Preview. Los datos del proveedor en estas pruebas son sintéticos.
- Next.js se actualizó de 16.4.0 a 16.4.6 por los avisos de seguridad. La compilación incluye TypeScript. La auditoría de dependencias de producción reportó cero hallazgos. El asesor de Supabase señala como informativas las tablas con RLS sin políticas para clientes. Sus permisos están revocados expresamente. DEV tiene además avisos previos de funciones ajenas a facturación y protección de contraseñas.
- Pendientes de evidencia del proveedor: checkout alojado, autorización del comprador de prueba, importe efectivamente cobrado, retorno, entrega de notificaciones y conciliación de la cuota. Registrar por modalidad el ID de prueba, precio, frecuencia, estado de autorización, ID/estado de cuota y entrega HTTP. Omitir secretos y datos de tarjeta.

Para repetir los controles locales en Node 24:

```sh
npm ci
node --conditions=react-server --test tests/pricing-v1.test.mjs
npm run build
npm audit --omit=dev
```

En DEV, ejecutar todo `sql/dev/test_pricing_v1.sql` en la misma transacción. El build requiere la configuración Supabase del entorno. Las advertencias por Upstash en una compilación local sin sus variables corresponden a otros módulos.

## Preview y prueba con Mercado Pago

1. Usar el proyecto Vercel `mi-primera-app`, entorno Preview, rama `feature/pricing-v1`. La URL y clave pública de Supabase deben ser de DEV. La clave privada `SUPABASE_SERVICE_ROLE_KEY` debe corresponder al mismo proyecto. `GET /api/mercadopago/subscribe` devuelve `catalog_ready` al comprobar los seis precios con la conexión del servidor.
2. Usar una aplicación de Suscripciones de prueba dedicada a v1. Guardar en Vercel `MP_V1_ACCESS_TOKEN`, `MP_V1_COLLECTOR_ID`, `MP_V1_APPLICATION_ID` y `MP_V1_WEBHOOK_SECRET`. Las ventas requieren además `PRICING_V1_SALES_ENABLED=true`. Preview verifica que un token distinto de TEST pertenezca a un vendedor de prueba antes de crear contratos. Vercel proporciona `VERCEL_BRANCH_URL` para construir el retorno estable. En desarrollo local se puede usar `MP_V1_DEV_ORIGIN` con la URL HTTPS del entorno de pruebas.
3. En la aplicación v1 registrar la URL estable de Preview con la ruta `/api/mercadopago/v1/webhook` para los tópicos `subscription_preapproval`, `subscription_authorized_payment` y `payment`. El webhook debe ser accesible desde Mercado Pago y responder desde la aplicación. Si Vercel exige autenticación, usar el mecanismo de acceso para automatizaciones del entorno de pruebas o un dominio DEV accesible. Conservar la protección del resto del sitio. La app histórica mantiene su URL y sus credenciales actuales.
4. Redesplegar Preview tras configurar variables. Verificar `catalog_ready=true` y `enabled=true`. Usar un administrador de negocio de prueba con correo de comprador de prueba y vendedor distinto. Para cada combinación usar un negocio separado o cerrar la suscripción anterior en el proveedor. Verificar un ciclo con retorno y otro cerrando el navegador tras autorizar, para comprobar activación por webhook.
5. Confirmar en el panel del proveedor el importe y la próxima fecha de cobro. Verificar respuesta 200 al webhook y cotejar `billing_prices`, `billing_contracts`, `billing_invoices` y `subscriptions`. Una notificación repetida debe producir una sola cuota. Cancelar los contratos de prueba al concluir.

## Publicación y recuperación

- Antes de integrar: completar la prueba del proveedor, revisar diferencias con `main`, comprobar respaldo recuperable y comparar conteos y condiciones de contratos anteriores. La landing consultada el 24 de noviembre aún mostraba “Más IVA”. Alinear el texto comercial con IVA incluido antes de abrir ventas.
- Aplicar en el destino las dos migraciones registradas, en orden. Verificar seis precios y los permisos. Desplegar primero con ventas v1 apagadas. Configurar credenciales y webhook de la aplicación de producción dedicada, verificar su acceso y luego habilitar altas. El apagado de ventas requiere redesplegar después de cambiar la variable.
- Si hay incidentes, poner `PRICING_V1_SALES_ENABLED=false` y redesplegar la misma versión. Confirmaciones y webhooks siguen conciliando contratos iniciados. Mantener tablas, versiones, credenciales e historial mientras haya contratos v1. Revertir solo el código previo a v1 dejaría sin receptor sus eventos.
- Un timeout después de crear un contrato remoto conserva el intento local. Al reintentar, el servidor busca la referencia exacta en las suscripciones del pagador o usa la notificación pendiente. Si la búsqueda no encuentra una coincidencia única, verificar en el panel antes de liberar el intento. Un checkout pendiente de otra modalidad también requiere resolver el anterior para evitar dos compromisos de cobro.
- La UI de superadministrador puede asignar planes manualmente. En un negocio con contrato de pago, gestionar cualquier modificación comercial desde Mercado Pago y conciliar el cambio para mantener acceso y cobro alineados.

[Suscripción pendiente en Mercado Pago](https://www.mercadopago.com.mx/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments) · [Referencia de facturas](https://www.mercadopago.com.mx/developers/es/reference/online-payments/subscriptions/get-authorized-payment/get)
