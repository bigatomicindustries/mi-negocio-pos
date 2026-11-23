# Mi Negocio CRM 1.5 — Contactos (DEV)

**Estado:** esquema y aislamiento implementados; interfaz y exportación aún pendientes.
**Rama exclusiva:** `feature/crm-contactos-1-5`
**Base de datos exclusiva:** Mi Negocio DEV (`pablbrladwjuczhazsms`)
**Migración aplicada en DEV:** `crm_contactos_1_5_base_multi_negocio`
**SQL versionado:** `sql/dev/crm_contactos_1_5.sql`

## Objetivo

Construir un directorio simple y reutilizable para el CRM interno de Mi Negocio y, posteriormente, para clientes con acceso contratado. Nunca mezclar información entre negocios.

## Modelo

- `crm_contactos`: persona/empresa, nombre, apellido, empresa, notas, creador, fechas y archivado lógico. `ambito='plataforma'` obliga a `business_id IS NULL`; `ambito='negocio'` exige un `business_id` válido.
- `crm_contacto_medios`: varios teléfonos y correos por contacto, uno principal por tipo. Se guarda el valor original y un valor normalizado para comparar coincidencias.
- `crm_acceso_negocios`: habilitación explícita, inicialmente sin registros. Ausencia de registro o `habilitado=false` equivale a acceso denegado.

**No se modificaron** `leads`, `demo_requests`, `crm_actividades`, `plans`, `subscriptions` ni tablas del POS.

## Seguridad y permisos

- RLS en las tres tablas.
- Contactos de plataforma: solo superadministradores activos, comprobados mediante `is_platform_admin()`.
- Contactos de negocios: solo usuarios activos con rol `admin` o `manager`, negocio activo, `business_id` coincidente y habilitación explícita.
- Los usuarios autenticados no pueden cambiar el ámbito ni el `business_id` de un contacto.
- Los medios de contacto heredan la visibilidad del contacto padre.
- No hay permisos `SELECT` para `anon`, ni `TRUNCATE` en ninguna de las tablas nuevas.
- No se concede `DELETE` sobre contactos: usar `archivado_at`; sí se permite borrar teléfonos/correos de un contacto autorizado.
- La habilitación comercial NO depende todavía de `plans` o `subscriptions`. Antes de ofrecerlo a clientes, conectar esta autorización con las reglas reales del Plan 3.

## Duplicados

- Correos: comparación en minúsculas y sin espacios externos.
- Teléfonos: comparación por dígitos, sin espacios, guiones o paréntesis.
- Un contacto no puede registrar dos veces el mismo medio normalizado.
- Dos contactos diferentes **sí** pueden compartir un medio (p. ej., conmutador o correo genérico). La UI deberá mostrar una alerta de posible duplicado y ofrecer revisar/vincular/fusionar manualmente, sin fusionar automáticamente.
- **Limitación:** `+52 55...` y `55...` no se consideran equivalentes aún. Antes de lanzar importaciones masivas, incorporar normalización telefónica por país/E.164, detección de coincidencias y confirmación humana.
- **Pendiente:** vincular los contactos de plataforma con `leads` y `demo_requests` sin alterar el historial comercial. El esquema de directorio por sí solo no evita duplicados entre esos formularios.

## Pruebas completadas en DEV

- Estructura, RLS y privilegios inspeccionados.
- Inserción y edición como superadministrador activo.
- Normalización de correos; rechazo del mismo correo duplicado dentro de un contacto.
- Coincidencias entre dos contactos permitidas para revisión manual.
- Intento de cambiar `ambito` rechazado.
- Acceso comercial desactivado por defecto: inserción de negocio rechazada.
- Dos negocios ficticios, habilitación temporal de uno, lectura e inserción propias permitidas, lectura e inserción cruzadas rechazadas.
- Usuario sin membresía: lectura e inserción rechazadas.
- Todos los datos y habilitaciones usados en QA fueron revertidos con `ROLLBACK`.

## Próxima etapa: interfaz

1. Pestaña **Contactos** en el CRM interno: listado, búsqueda, alta, edición, archivado, múltiples teléfonos/correos y ficha de contacto.
2. Alertas de coincidencia de correo/teléfono antes de guardar; nunca fusionar automáticamente.
3. Vinculación explícita a prospectos de `leads` y `demo_requests` sin perder historial.
4. Exportación CSV UTF-8 compatible con Brevo/Google, con autorización, columnas seleccionables y protección contra fórmulas CSV; no exportar datos de otros negocios.
5. Importación CSV con vista previa, validación, normalización y deduplicación supervisada.
6. Tablero Kanban y oportunidades vinculadas a contactos, con agenda e historial.
7. Pruebas adicionales de permisos, límites de plan, usuarios de distintos negocios y despliegue de prueba autorizado.

**Restricciones:** sin producción, sin cambios en planes reales, sin publicación comercial y sin migración automática de datos existentes.
