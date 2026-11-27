"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { imprimirTicket } from "@/lib/imprimirTicket";
import { useAuth } from "@/context/AuthContext";
import { nombreRol } from "@/lib/roles";

type Venta = {
  id: string;
  number: string;
  total: number;
  paid_amount: number;
  change_due: number;
  payment_method: "cash" | "card" | "transfer";
  created_at: string;

  user_id: string | null;
  user_name: string | null;
  user_role: "admin" | "manager" | "cashier" | null;
};

type ItemVenta = {
  id: string;
  sale_id: string;
  product_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
};

type DetalleDevolucionItem = {
  sale_item_id: string;
  product_id: string | null;
  product_name: string;
  sale_unit: "piece" | "kg";
  sold_quantity: number;
  returned_quantity: number;
  available_quantity: number;
  unit_price: number;
  available_amount: number;
  returnable: boolean;
};

type DetalleDevolucion = {
  sale_id: string;
  sale_number: string | null;
  branch_id: string;
  branch_active: boolean;
  payment_method: "cash" | "card" | "transfer";
  sale_total: number;
  total_refunded: number;
  remaining_refundable_amount: number;
  can_create_return: boolean;
  items: DetalleDevolucionItem[];
};

type Props = {
  venta: Venta | null;
  items: ItemVenta[];
  onCerrar: () => void;
};

export default function DetalleVenta({
  venta,
  items,
  onCerrar,
}: Props) {
const { puedeAdministrar, negocio } = useAuth();

const [detalleDevolucion, setDetalleDevolucion] =
  useState<DetalleDevolucion | null>(null);

const [cargandoDevolucion, setCargandoDevolucion] =
  useState(false);

  const [mostrarModalDevolucion, setMostrarModalDevolucion] =
  useState(false);

const [cantidadesDevolucion, setCantidadesDevolucion] =
  useState<Record<string, number>>({});

const [mostrarConfirmacionDevolucion, setMostrarConfirmacionDevolucion] =
  useState(false);

const [motivoDevolucion, setMotivoDevolucion] =
  useState("");

  const [procesandoDevolucion, setProcesandoDevolucion] =
  useState(false);

const [errorDevolucion, setErrorDevolucion] =
  useState<string | null>(null);

  const requestIdDevolucionRef =
  useRef<string | null>(null);

async function cargarDetalleDevolucion(
  ventaId: string
) {
  setCargandoDevolucion(true);

  const { data, error } = await supabase.rpc(
    "get_sale_return_details",
    {
      p_sale_id: ventaId,
    }
  );

  if (error) {
    console.error(
      "Error cargando detalle de devolución:",
      error
    );

    setDetalleDevolucion(null);
    setCargandoDevolucion(false);

    return false;
  }

  setDetalleDevolucion(
    data as DetalleDevolucion
  );

  setCargandoDevolucion(false);

  return true;
}

useEffect(() => {
  if (!venta || !puedeAdministrar) {
    setDetalleDevolucion(null);
    return;
  }

  void cargarDetalleDevolucion(venta.id);
}, [venta, puedeAdministrar]);

if (!venta) return null;

  const itemsVenta = items.filter(
    (item) => item.sale_id === venta.id
  );

  const costoVenta = itemsVenta.reduce(
    (suma, item) =>
      suma +
      Number(item.unit_cost) * Number(item.quantity),
    0
  );

  const utilidadVenta =
    Number(venta.total) - costoVenta;

  const formatoDinero = (cantidad: number) =>
    new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
    }).format(cantidad);

  const formatoFecha = (fecha: string) =>
    new Date(fecha).toLocaleString("es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

function abrirModalDevolucion() {
  if (!detalleDevolucion?.can_create_return) {
    return;
  }

  const cantidadesIniciales: Record<string, number> = {};

  detalleDevolucion.items.forEach((item) => {
    if (item.returnable) {
      cantidadesIniciales[item.sale_item_id] = 0;
    }
  });

  requestIdDevolucionRef.current = null;
  setErrorDevolucion(null);
  setMotivoDevolucion("");
  setMostrarConfirmacionDevolucion(false);
  setCantidadesDevolucion(cantidadesIniciales);
  setMostrarModalDevolucion(true);
}

function cerrarModalDevolucion() {
  if (procesandoDevolucion) return;

  requestIdDevolucionRef.current = null;
  setErrorDevolucion(null);
  setMotivoDevolucion("");
  setMostrarConfirmacionDevolucion(false);
  setMostrarModalDevolucion(false);
  setCantidadesDevolucion({});
}

function cerrarConfirmacionDevolucion() {
  if (procesandoDevolucion) return;

  setMostrarConfirmacionDevolucion(false);
  setErrorDevolucion(null);
}

function abrirConfirmacionDevolucion() {
  if (itemsSeleccionadosDevolucion.length === 0) {
    setErrorDevolucion(
      "Selecciona al menos un producto para devolver."
    );
    return;
  }

  setErrorDevolucion(null);
  setMostrarConfirmacionDevolucion(true);
}

async function procesarDevolucion() {
  if (!venta || !detalleDevolucion) return;

  if (itemsSeleccionadosDevolucion.length === 0) {
    setErrorDevolucion(
      "Selecciona al menos un producto para devolver."
    );
    return;
  }

  if (procesandoDevolucion) return;

  setProcesandoDevolucion(true);
  setErrorDevolucion(null);

if (!requestIdDevolucionRef.current) {
  requestIdDevolucionRef.current =
    crypto.randomUUID();
}

const requestId =
  requestIdDevolucionRef.current;

  const itemsParaDevolver =
    itemsSeleccionadosDevolucion.map((item) => ({
      sale_item_id: item.sale_item_id,
      quantity: Number(
        cantidadesDevolucion[item.sale_item_id]
      ),
    }));

  const { data, error } = await supabase.rpc(
    "create_sale_return",
    {
      p_sale_id: venta.id,
      p_items: itemsParaDevolver,
      p_request_id: requestId,
      p_reason:
        motivoDevolucion.trim() || null,
    }
  );

  if (error) {
    console.error(
      "Error registrando devolución:",
      error
    );

    setErrorDevolucion(error.message);
    setProcesandoDevolucion(false);
    return;
  }

  console.log(
    "Devolución registrada:",
    data
  );

const detalleActualizado =
  await cargarDetalleDevolucion(venta.id);

if (!detalleActualizado) {
  setErrorDevolucion(
    "La devolución se registró correctamente, pero no se pudo actualizar el detalle de la venta."
  );
  setProcesandoDevolucion(false);
  return;
}

requestIdDevolucionRef.current = null;

setMostrarConfirmacionDevolucion(false);
setMostrarModalDevolucion(false);
setCantidadesDevolucion({});
setMotivoDevolucion("");
setErrorDevolucion(null);
setProcesandoDevolucion(false);

alert("Devolución registrada correctamente.");
}

function cambiarCantidadDevolucion(
  item: DetalleDevolucionItem,
  valor: string
) {

  requestIdDevolucionRef.current = null;
setErrorDevolucion(null);

  if (!item.returnable) return;

  if (valor === "") {
    setCantidadesDevolucion((actual) => ({
      ...actual,
      [item.sale_item_id]: 0,
    }));
    return;
  }

  const numero = Number(valor);

  if (!Number.isFinite(numero)) return;

  const maximo =
    Number(item.available_quantity);

  const cantidad =
    Math.min(Math.max(numero, 0), maximo);

  const cantidadFinal =
    item.sale_unit === "piece"
      ? Math.floor(cantidad)
      : Math.round(cantidad * 1000) / 1000;

  setCantidadesDevolucion((actual) => ({
    ...actual,
    [item.sale_item_id]: cantidadFinal,
  }));
}

const itemsSeleccionadosDevolucion =
  detalleDevolucion?.items.filter(
    (item) =>
      item.returnable &&
      Number(
        cantidadesDevolucion[item.sale_item_id] ?? 0
      ) > 0
  ) ?? [];

const totalDevolucion =
  itemsSeleccionadosDevolucion.reduce(
    (total, item) =>
      total +
      Number(
        cantidadesDevolucion[item.sale_item_id] ?? 0
      ) *
        Number(item.unit_price),
    0
  );

  function reimprimirTicket() {
    if (venta && negocio) imprimirTicket(negocio.name, venta, itemsVenta);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onCerrar}
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ENCABEZADO */}

        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-green-600">
              Detalle de venta
            </p>

            <h2 className="mt-2 text-2xl font-bold text-slate-900">
              {venta.number}
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              {formatoFecha(venta.created_at)}
            </p>
          </div>

          <button
            onClick={onCerrar}
            className="rounded-xl bg-slate-100 px-4 py-2 font-semibold text-slate-600 transition hover:bg-slate-200"
          >
            ✕
          </button>
        </div>

{/* INFORMACIÓN DE LA VENTA */}

<div className="mt-6 grid gap-3 sm:grid-cols-2">
  <div className="rounded-2xl bg-slate-50 p-4">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
      Método de pago
    </p>

<p className="mt-2 font-semibold text-slate-900">
  {venta.payment_method === "cash"
    ? "Efectivo"
    : venta.payment_method === "card"
    ? "Tarjeta"
    : "Transferencia"}
</p>
  </div>

  <div className="rounded-2xl bg-slate-50 p-4">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
      Atendió
    </p>

    {venta.user_name ? (
      <>
        <p className="mt-2 font-semibold text-slate-900">
          {venta.user_name}
        </p>

{venta.user_role && (
  <p className="mt-1 text-xs text-slate-500">
    {nombreRol(venta.user_role)}
  </p>
)}
      </>
    ) : (
      <p className="mt-2 text-slate-400">
        —
      </p>
    )}
  </div>
</div>

        {/* PRODUCTOS */}

        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Productos
          </p>

          <div className="mt-4 overflow-hidden rounded-2xl border">
            {itemsVenta.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                No se encontraron productos para esta venta.
              </div>
            ) : (
              itemsVenta.map((item, index) => {
                const subtotal =
                  Number(item.unit_price) *
                  Number(item.quantity);

                return (
                  <div
                    key={`${item.product_id ?? "producto"}-${index}`}
                    className="border-b px-5 py-4 last:border-b-0"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {item.name}
                        </p>

                        <p className="mt-1 text-sm text-slate-500">
                          {item.quantity} ×{" "}
                          {formatoDinero(
                            Number(item.unit_price)
                          )}
                        </p>
                      </div>

                      <p className="font-bold">
                        {formatoDinero(subtotal)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

{puedeAdministrar && (
  <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 className="font-bold text-slate-900">
          Devoluciones
        </h3>

        <p className="mt-1 text-sm text-slate-500">
          Estado de los productos de esta venta
        </p>
      </div>

      {cargandoDevolucion && (
        <span className="text-sm text-slate-400">
          Consultando...
        </span>
      )}
    </div>

    {!cargandoDevolucion && detalleDevolucion && (
      <>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-white p-4">
            <p className="text-xs text-slate-500">
              Total de la venta
            </p>

            <p className="mt-1 font-bold text-slate-900">
              {formatoDinero(
                Number(detalleDevolucion.sale_total)
              )}
            </p>
          </div>

          <div className="rounded-xl bg-white p-4">
            <p className="text-xs text-slate-500">
              Total devuelto
            </p>

            <p className="mt-1 font-bold text-slate-900">
              {formatoDinero(
                Number(detalleDevolucion.total_refunded)
              )}
            </p>
          </div>

          <div className="rounded-xl bg-white p-4">
            <p className="text-xs text-slate-500">
              Disponible para devolución
            </p>

            <p className="mt-1 font-bold text-slate-900">
              {formatoDinero(
                Number(
                  detalleDevolucion.remaining_refundable_amount
                )
              )}
            </p>
          </div>
        </div>

        <div className="mt-4 divide-y rounded-xl border bg-white">
          {detalleDevolucion.items.map((item) => (
            <div
              key={item.sale_item_id}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div>
                <p className="font-semibold text-slate-900">
                  {item.product_name}
                </p>

                <p className="mt-1 text-sm text-slate-500">
                  Vendido:{" "}
                  {item.sold_quantity}{" "}
                  {item.sale_unit === "kg"
                    ? "kg"
                    : "pieza(s)"}
                </p>

                <p className="text-sm text-slate-500">
                  Devuelto:{" "}
                  {item.returned_quantity}{" "}
                  {item.sale_unit === "kg"
                    ? "kg"
                    : "pieza(s)"}
                </p>
              </div>

              <div className="text-right">
                <p
                  className={`font-semibold ${
                    item.available_quantity > 0
                      ? "text-emerald-600"
                      : "text-slate-400"
                  }`}
                >
                  {item.available_quantity}{" "}
                  {item.sale_unit === "kg"
                    ? "kg"
                    : "pieza(s)"}
                </p>

                <p className="text-xs text-slate-400">
                  {item.returnable
                    ? "Disponible"
                    : "Sin devolución disponible"}
                </p>
              </div>
            </div>
          ))}
        </div>

<div className="mt-4">
  {detalleDevolucion.can_create_return ? (
    <button
      type="button"
      onClick={abrirModalDevolucion}
      className="w-full rounded-xl bg-amber-500 px-5 py-3 font-semibold text-white transition hover:bg-amber-600"
    >
      Registrar devolución
    </button>
  ) : (

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-semibold text-slate-600">
                Esta venta no tiene productos disponibles para devolución.
              </p>
            </div>
          )}
        </div>
      </>
    )}
  </div>
)}

        {/* TOTALES */}

        <div className="mt-8 rounded-2xl bg-slate-50 p-5">
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-500">
                Total
              </span>

              <strong>
                {formatoDinero(Number(venta.total))}
              </strong>
            </div>

{venta.payment_method === "cash" ? (
  <>
    <div className="flex justify-between">
      <span className="text-slate-500">
        Efectivo recibido
      </span>

      <strong>
        {formatoDinero(Number(venta.paid_amount))}
      </strong>
    </div>

    <div className="flex justify-between">
      <span className="text-slate-500">
        Cambio
      </span>

      <strong>
        {formatoDinero(Number(venta.change_due))}
      </strong>
    </div>
  </>
) : (
  <div className="flex justify-between">
    <span className="text-slate-500">
      {venta.payment_method === "transfer"
        ? "Pago por transferencia"
        : "Pago con tarjeta"}
    </span>

    <strong>
      {formatoDinero(Number(venta.total))}
    </strong>
  </div>
)}

{puedeAdministrar && (
  <>
    <div className="border-t pt-3">
      <div className="flex justify-between">
        <span className="text-slate-500">
          Costo
        </span>

        <strong>
          {formatoDinero(costoVenta)}
        </strong>
      </div>
    </div>

    <div className="flex justify-between">
      <span className="font-bold">
        Utilidad bruta
      </span>

      <strong
        className={
          utilidadVenta >= 0
            ? "text-green-600"
            : "text-red-600"
        }
      >
        {formatoDinero(utilidadVenta)}
      </strong>
    </div>
  </>
)}
        </div>
      </div>

       <div className="mt-8 grid gap-3 sm:grid-cols-2">

  <button
    type="button"
    onClick={reimprimirTicket}
    className="rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
  >
    🖨️ Reimprimir ticket
  </button>

  <button
    type="button"
    onClick={onCerrar}
    className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white transition hover:bg-slate-800"
  >
    Cerrar
  </button>

</div>

{mostrarModalDevolucion && detalleDevolucion && (
  <div
    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
    onClick={cerrarModalDevolucion}
  >
    <div
      className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* ENCABEZADO */}

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-green-600">
            DEVOLUCIÓN
          </p>

          <h2 className="mt-1 text-2xl font-bold text-slate-900">
            Registrar devolución
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Venta {venta.number}
          </p>
        </div>

        <button
          type="button"
          onClick={cerrarModalDevolucion}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-500 transition hover:bg-slate-200"
        >
          ×
        </button>
      </div>

      {/* PRODUCTOS */}

      <div className="mt-6 space-y-4">
        {detalleDevolucion.items
          .filter((item) => item.returnable)
          .map((item) => {
            const cantidad =
              cantidadesDevolucion[item.sale_item_id] ?? 0;

            const subtotal =
              cantidad * Number(item.unit_price);

            return (
              <div
                key={item.sale_item_id}
                className="rounded-2xl border border-slate-200 p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-bold text-slate-900">
                      {item.product_name}
                    </h3>

                    <p className="mt-1 text-sm text-slate-500">
                      Precio:{" "}
                      {formatoDinero(
                        Number(item.unit_price)
                      )}
                    </p>

                    <p className="text-sm text-slate-500">
                      Disponible:{" "}
                      {item.available_quantity}{" "}
                      {item.sale_unit === "kg"
                        ? "kg"
                        : "pieza(s)"}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-xs text-slate-400">
                      Máximo
                    </p>

                    <p className="font-semibold text-slate-700">
                      {item.available_quantity}
                    </p>
                  </div>
                </div>

                {/* CANTIDAD */}

                <div className="mt-4">
                  <label className="text-sm font-medium text-slate-700">
                    Cantidad a devolver
                  </label>

                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="number"
                      min="0"
                      max={item.available_quantity}
                      step={
                        item.sale_unit === "piece"
                          ? "1"
                          : "0.001"
                      }
                      value={
                        cantidad === 0
                          ? ""
                          : cantidad
                      }
                      onChange={(e) =>
                        cambiarCantidadDevolucion(
                          item,
                          e.target.value
                        )
                      }
                      placeholder="0"
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg font-semibold outline-none transition focus:border-green-500 focus:ring-2 focus:ring-green-100"
                    />

                    <span className="whitespace-nowrap text-sm text-slate-500">
                      {item.sale_unit === "kg"
                        ? "kg"
                        : "pieza(s)"}
                    </span>
                  </div>
                </div>

                {/* SUBTOTAL */}

                {cantidad > 0 && (
                  <div className="mt-4 flex items-center justify-between border-t pt-4">
                    <span className="text-sm text-slate-500">
                      Subtotal devolución
                    </span>

                    <span className="font-bold text-slate-900">
                      {formatoDinero(subtotal)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* TOTAL */}

      <div className="mt-6 flex items-center justify-between rounded-2xl bg-slate-900 p-5 text-white">
        <div>
          <p className="text-sm text-slate-300">
            Total a devolver
          </p>

          <p className="mt-1 text-xs text-slate-400">
            Se calculará con el precio original de la venta.
          </p>
        </div>

        <p className="text-2xl font-bold">
          {formatoDinero(totalDevolucion)}
        </p>
      </div>

      {/* AVISO */}

      {itemsSeleccionadosDevolucion.length === 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">
            Selecciona al menos un producto y una cantidad
            para continuar.
          </p>
        </div>
      )}

{errorDevolucion && (
  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
    <p className="text-sm font-medium text-red-700">
      {errorDevolucion}
    </p>
  </div>
)}

      {/* BOTONES */}

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={cerrarModalDevolucion}
          className="rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          Cancelar
        </button>

<button
  type="button"
  onClick={abrirConfirmacionDevolucion}
  disabled={itemsSeleccionadosDevolucion.length === 0}
  className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
>
  Continuar
</button>
      </div>
    </div>
  </div>
)}

{mostrarConfirmacionDevolucion && detalleDevolucion && (
  <div
    className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
    onClick={cerrarConfirmacionDevolucion}
  >
    <div
      className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* ENCABEZADO */}

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-amber-600">
            CONFIRMAR DEVOLUCIÓN
          </p>

          <h2 className="mt-1 text-2xl font-bold text-slate-900">
            Revisa antes de continuar
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Venta {venta.number}
          </p>
        </div>

<button
  type="button"
  onClick={cerrarConfirmacionDevolucion}
  disabled={procesandoDevolucion}
  className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-500 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
>
  ×
</button>
      </div>

      {/* PRODUCTOS */}

      <div className="mt-6 divide-y rounded-2xl border border-slate-200">
        {itemsSeleccionadosDevolucion.map((item) => {
          const cantidad =
            cantidadesDevolucion[item.sale_item_id] ?? 0;

          const subtotal =
            cantidad * Number(item.unit_price);

          return (
            <div
              key={item.sale_item_id}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div>
                <p className="font-semibold text-slate-900">
                  {item.product_name}
                </p>

                <p className="mt-1 text-sm text-slate-500">
                  {cantidad}{" "}
                  {item.sale_unit === "kg"
                    ? "kg"
                    : "pieza(s)"}{" "}
                  × {formatoDinero(Number(item.unit_price))}
                </p>
              </div>

              <p className="font-bold text-slate-900">
                {formatoDinero(subtotal)}
              </p>
            </div>
          );
        })}
      </div>

      {/* MÉTODO DE REEMBOLSO */}

      <div className="mt-5 rounded-2xl bg-slate-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Método de reembolso
        </p>

        <p className="mt-1 font-bold text-slate-900">
          {detalleDevolucion.payment_method === "cash"
            ? "Efectivo"
            : detalleDevolucion.payment_method === "card"
            ? "Tarjeta"
            : "Transferencia"}
        </p>

{detalleDevolucion.payment_method === "cash" && (
  <p className="mt-2 text-sm text-slate-500">
    El reembolso se descontará de la caja abierta actual de
    la sucursal donde se realizó la venta. Si no hay una caja
    abierta o no existe efectivo suficiente, la devolución
    será rechazada.
  </p>
)}

        {detalleDevolucion.payment_method !== "cash" && (
          <p className="mt-2 text-sm text-slate-500">
            Se registrará la devolución y el regreso del
            producto al inventario. El reembolso externo no
            se procesa automáticamente.
          </p>
        )}
      </div>

      {/* MOTIVO */}

      <div className="mt-5">
        <label className="text-sm font-semibold text-slate-700">
          Motivo de la devolución
        </label>

        <textarea
          value={motivoDevolucion}
onChange={(e) => {
  requestIdDevolucionRef.current = null;
  setErrorDevolucion(null);
  setMotivoDevolucion(e.target.value);
}}
          rows={3}
          maxLength={500}
          placeholder="Opcional. Ej. Producto equivocado, cambio del cliente..."
          className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-green-500 focus:ring-2 focus:ring-green-100"
        />

        <p className="mt-1 text-right text-xs text-slate-400">
          {motivoDevolucion.length}/500
        </p>
      </div>

      {/* TOTAL */}

      <div className="mt-5 flex items-center justify-between rounded-2xl bg-slate-900 p-5 text-white">
        <span className="font-medium">
          Total a devolver
        </span>

        <span className="text-2xl font-bold">
          {formatoDinero(totalDevolucion)}
        </span>
      </div>

      {/* ADVERTENCIA */}

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          Al confirmar, las cantidades seleccionadas volverán
          al inventario de la sucursal original de la venta.
        </p>
      </div>

      {/* BOTONES */}

      <div className="mt-6 grid grid-cols-2 gap-3">
<button
  type="button"
  onClick={cerrarConfirmacionDevolucion}
  disabled={procesandoDevolucion}
  className="rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
>
  Regresar
</button>

<button
  type="button"
  onClick={() => void procesarDevolucion()}
  disabled={
    procesandoDevolucion ||
    itemsSeleccionadosDevolucion.length === 0
  }
  className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
>
  {procesandoDevolucion
    ? "Procesando..."
    : "Confirmar devolución"}
</button>
      </div>
    </div>
  </div>
)}

      </div>
    </div>
  );
}