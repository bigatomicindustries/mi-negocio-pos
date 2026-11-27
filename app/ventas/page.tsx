"use client";

import { useEffect, useMemo, useState } from "react";

import BarcodeCamera from "./BarcodeCamera";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

type Product = {
  id: string;
  name: string;
  barcode: string | null;
  stock: number;
  sale_price: number;
  minimum_stock: number;
  sale_unit: "piece" | "kg";
};

type CartItem = Product & {
  quantity: number;
};

type PaymentSettings = {
  bank_name: string | null;
  account_holder: string | null;
  clabe: string | null;
  account_number: string | null;
  transfer_enabled: boolean;
};

async function inventarioSucursal(branchId: string): Promise<Product[]> {
  const products: Product[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("branch_inventory")
      .select("stock,minimum_stock,product:products!inner(id,name,barcode,sale_price,sale_unit)")
      .eq("branch_id", branchId).order("product_id").range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const item = row.product as unknown as Pick<Product, "id" | "name" | "barcode" | "sale_price" | "sale_unit">;
      products.push({ ...item, sale_price: Number(item.sale_price), stock: Number(row.stock), minimum_stock: Number(row.minimum_stock) });
    }
    if (!data || data.length < pageSize) break;
  }
  return products.sort((a, b) => a.name.localeCompare(b.name));
}

export default function VentasPage() {
  const { sucursalActiva, cargandoSucursales } = useAuth();

  return <VentaSucursal key={sucursalActiva?.id ?? "sin-sucursal"} sucursalActiva={sucursalActiva} cargandoSucursales={cargandoSucursales} />;
}

function VentaSucursal({ sucursalActiva, cargandoSucursales }: Pick<ReturnType<typeof useAuth>, "sucursalActiva" | "cargandoSucursales">) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cantidadesKg, setCantidadesKg] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
const [mostrarPago, setMostrarPago] = useState(false);

const [mostrarCarritoMovil, setMostrarCarritoMovil] = useState(false);

const [metodoPago, setMetodoPago] =
  useState<"cash" | "card" | "transfer">("cash");

const [efectivoRecibido, setEfectivoRecibido] = useState("");

const [ventaCompletada, setVentaCompletada] =
  useState<any>(null);

const [paymentSettings, setPaymentSettings] =
  useState<PaymentSettings | null>(null);

const [whatsappTransferencia, setWhatsappTransferencia] =
  useState("");

const [errorTransferencia, setErrorTransferencia] =
  useState("");

// =========================
// CONFIGURACIÓN DE PAGOS
// =========================

useEffect(() => {
  async function cargarConfiguracionPagos() {
    const { data, error } = await supabase
      .from("business_payment_settings")
      .select(
        `
          bank_name,
          account_holder,
          clabe,
          account_number,
          transfer_enabled
        `
      )
      .maybeSingle();

    if (error) {
      console.error(
        "Error cargando configuración de pagos:",
        error
      );

      setPaymentSettings(null);
      return;
    }

    setPaymentSettings(data);
  }

  void cargarConfiguracionPagos();
}, []);

  // =========================
  // CARGAR PRODUCTOS
  // =========================

useEffect(() => {
  async function cargarProductos() {
    if (cargandoSucursales) {
      return;
    }

    if (!sucursalActiva) {
      setProducts([]);
      setCart([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      setProducts(await inventarioSucursal(sucursalActiva.id));
    } catch {
      setError("No se pudo cargar el inventario de la sucursal.");
      setProducts([]);
    }

    // El carrito pertenece a la sucursal donde fue creado.
    // Al cambiar de sucursal, se vacía para evitar mezclar inventarios.
    setCart([]);

    setLoading(false);
  }

  cargarProductos();
}, [
  cargandoSucursales,
  sucursalActiva?.id,
]);

  // =========================
  // BUSCADOR
  // =========================

  const productosFiltrados = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) =>
      product.name.toLowerCase().includes(term) || product.barcode?.toLowerCase().includes(term)
    );
  }, [products, search]);

  // =========================
  // AGREGAR AL CARRITO
  // =========================

function procesarEscaneo(raw: string) {
  setCameraOpen(false);
  const code = raw.trim();
  // A UPC-A can also be read as an EAN-13 with a leading zero.
  const alternate = /^0[0-9]{12}$/.test(code) ? code.slice(1) : /^[0-9]{12}$/.test(code) ? "0" + code : null;
  const product = products.find(p => p.barcode === code) ?? (alternate && products.find(p => p.barcode === alternate));
  if (!product) {
    setSearch(code);
    setScanStatus("Código " + code + " sin registrar en esta sucursal.");
    return;
  }
  const quantity = cart.find(item => item.id === product.id)?.quantity ?? 0;
  const increment = product.sale_unit === "kg" ? (quantity ? 0.25 : Math.min(0.25, product.stock)) : 1;
  if (product.stock <= 0 || Number((quantity + increment).toFixed(3)) > product.stock) {
    setScanStatus("Existencias insuficientes para agregar " + product.name + ".");
    return;
  }
  agregarProducto(product);
  setSearch("");
  setScanStatus(product.name + " agregado al carrito.");
}

function agregarProducto(product: Product) {
  setCart((currentCart) => {
    const existing = currentCart.find(
      (item) => item.id === product.id
    );

const incremento =
  product.sale_unit === "kg" ? 0.250 : 1;

    if (existing) {
const nuevaCantidad =
  product.sale_unit === "kg"
    ? Number((existing.quantity + incremento).toFixed(3))
    : existing.quantity + incremento;

      if (nuevaCantidad > product.stock) {
        return currentCart;
      }

      return currentCart.map((item) =>
        item.id === product.id
          ? {
              ...item,
              quantity: nuevaCantidad,
            }
          : item
      );
    }

if (product.stock <= 0) {
  return currentCart;
}

if (
  product.sale_unit === "kg" &&
  product.stock < 0.250
) {
  return [
    ...currentCart,
    {
      ...product,
      quantity: Number(product.stock.toFixed(3)),
    },
  ];
}

    return [
      ...currentCart,
      {
        ...product,
quantity:
  product.sale_unit === "kg"
    ? 0.250
    : 1,
      },
    ];
  });
}

  // =========================
  // AUMENTAR CANTIDAD
  // =========================

function aumentarCantidad(id: string) {
  setCart((currentCart) =>
    currentCart.map((item) => {
      if (item.id !== id) {
        return item;
      }

const incremento =
  item.sale_unit === "kg" ? 0.250 : 1;

const nuevaCantidad =
  item.sale_unit === "kg"
    ? Number((item.quantity + incremento).toFixed(3))
    : item.quantity + incremento;

      if (nuevaCantidad > item.stock) {
        return item;
      }

      return {
        ...item,
        quantity: nuevaCantidad,
      };
    })
  );
}

  // =========================
  // DISMINUIR CANTIDAD
  // =========================

function disminuirCantidad(id: string) {
  setCart((currentCart) =>
    currentCart
      .map((item) => {
        if (item.id !== id) {
          return item;
        }

const decremento =
  item.sale_unit === "kg" ? 0.250 : 1;

const nuevaCantidad =
  item.sale_unit === "kg"
    ? Number((item.quantity - decremento).toFixed(3))
    : item.quantity - decremento;

        return {
          ...item,
          quantity: nuevaCantidad,
        };
      })
      .filter((item) => item.quantity > 0)
  );
}

  // =========================
  // ELIMINAR PRODUCTO
  // =========================

  function eliminarProducto(id: string) {
    setCart((currentCart) =>
      currentCart.filter((item) => item.id !== id)
    );
  }

  // =========================
  // VACIAR CARRITO
  // =========================

  function vaciarCarrito() {
    setCart([]);
  }

  // =========================
  // TOTALES
  // =========================

  const total = useMemo(() => {
    return cart.reduce(
      (sum, item) =>
        sum + Number(item.sale_price) * item.quantity,
      0
    );
  }, [cart]);

const totalProductos = cart.length;

  const efectivo = Number(efectivoRecibido) || 0;
const cambio = Math.max(0, efectivo - total);
const efectivoInsuficiente = efectivo < total;
  
// =========================
// COBRAR VENTA
// =========================

async function cobrarVenta() {
  if (!sucursalActiva) {
    alert("No hay una sucursal activa seleccionada");
    return;
  }

  if (cart.length === 0) {
    alert("El carrito está vacío");
    return;
  }

  try {
    const items = cart.map((item) => ({
      product_id: item.id,
      quantity: item.quantity,
    }));

const { data, error } = await supabase.rpc("create_sale", {
  p_items: items,

  p_paid_amount:
    metodoPago === "cash"
      ? efectivo
      : total,

  p_payment_method: metodoPago,
  p_branch_id: sucursalActiva.id,
});

    if (error) {
      console.error("Error al cobrar:", error);
      alert(`No se pudo completar la venta: ${error.message}`);
      return;
    }

setVentaCompletada({
  number: data?.number,

  total: Number(
    data?.total ?? total
  ),

  paid_amount: Number(
    data?.paid_amount ??
      (metodoPago === "cash"
        ? efectivo
        : total)
  ),

  change_due: Number(
    data?.change_due ??
      (metodoPago === "cash"
        ? cambio
        : 0)
  ),

  payment_method:
    data?.payment_method ?? metodoPago,

  items: [...cart],
});

setMostrarPago(false);

    setCart([]);

    // Actualizar inventario en pantalla
    try {
      setProducts(await inventarioSucursal(sucursalActiva.id));
    } catch {
      setProducts([]);
      setError("La venta se registró. Recarga Ventas para actualizar las existencias.");
    }
  } catch (error) {
    console.error("Error inesperado:", error);
    alert("Ocurrió un error inesperado al procesar la venta");
  }
}

// =========================
// ENVIAR DATOS POR WHATSAPP
// =========================

function enviarDatosTransferencia() {
  setErrorTransferencia("");

  const telefono = whatsappTransferencia.replace(/\D/g, "");

  if (telefono.length !== 10) {
    setErrorTransferencia(
      "Escribe un número de WhatsApp de 10 dígitos."
    );
    return;
  }

  if (!paymentSettings?.transfer_enabled) {
    setErrorTransferencia(
      "Las transferencias no están habilitadas para este negocio."
    );
    return;
  }

  if (
    !paymentSettings.bank_name ||
    !paymentSettings.account_holder ||
    !paymentSettings.clabe
  ) {
    setErrorTransferencia(
      "Faltan datos bancarios en la configuración."
    );
    return;
  }

  const mensaje = [
    "Hola 👋",
    "",
    "Estos son los datos para realizar tu transferencia:",
    "",
    `Banco: ${paymentSettings.bank_name}`,
    `Titular: ${paymentSettings.account_holder}`,
    `CLABE: ${paymentSettings.clabe}`,
    paymentSettings.account_number
      ? `Cuenta: ${paymentSettings.account_number}`
      : "",
    "",
    `Monto: ${formatoDinero(total)}`,
    "",
    "Cuando realices la transferencia puedes enviar tu comprobante por este mismo medio.",
  ]
    .filter(Boolean)
    .join("\n");

  const url =
    `https://wa.me/52${telefono}` +
    `?text=${encodeURIComponent(mensaje)}`;

  window.open(
    url,
    "_blank",
    "noopener,noreferrer"
  );
}

// =========================
// ENVIAR TICKET POR WHATSAPP
// =========================

function enviarTicketWhatsApp() {
  if (!ventaCompletada) {
    return;
  }

  const telefono = whatsappTransferencia.replace(/\D/g, "");

  if (telefono.length !== 10) {
    alert(
      "No hay un número de WhatsApp válido para enviar el ticket."
    );
    return;
  }

  const metodo =
    ventaCompletada.payment_method === "cash"
      ? "Efectivo"
      : ventaCompletada.payment_method === "card"
      ? "Tarjeta"
      : "Transferencia";

  const productos = ventaCompletada.items.map((item: any) => {
    const cantidad =
      item.sale_unit === "kg"
        ? `${Number(item.quantity).toFixed(3)} kg`
        : `${item.quantity} ${
            item.quantity === 1 ? "pieza" : "piezas"
          }`;

    const subtotal =
      Number(item.sale_price) * Number(item.quantity);

    return `${item.name}
${cantidad} × ${formatoDinero(Number(item.sale_price))}
${formatoDinero(subtotal)}`;
  });

  const mensaje = [
    "🧾 TICKET DE COMPRA",
    "",
    `Folio: ${ventaCompletada.number}`,
    "",
    ...productos,
    "",
    "--------------------",
    `Total: ${formatoDinero(ventaCompletada.total)}`,
    `Método de pago: ${metodo}`,
    "",
    "¡Gracias por tu compra! 🙌",
  ].join("\n");

  const url =
    `https://wa.me/52${telefono}` +
    `?text=${encodeURIComponent(mensaje)}`;

  window.open(
    url,
    "_blank",
    "noopener,noreferrer"
  );
}

  // =========================
  // FORMATO MXN
  // =========================

  const formatoDinero = (cantidad: number) =>
    new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
    }).format(cantidad);

  // =========================
  // INTERFAZ
  // =========================

  return (
    <>
    <main className="min-h-screen bg-slate-50 p-5 text-slate-900 md:p-10">
      <div className="mx-auto max-w-7xl">

        {/* ENCABEZADO */}

        <div>
          <p className="text-sm font-medium text-green-600">
            MI NEGOCIO POS
          </p>

          <h1 className="mt-1 text-3xl font-bold">
            Nueva venta
          </h1>

          <p className="mt-2 text-slate-500">
            Selecciona los productos de esta venta
          </p>

        </div>

        {/* CONTENIDO */}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_420px]">

          {/* ===================== */}
          {/* PRODUCTOS */}
          {/* ===================== */}

          <section>

            {/* BUSCADOR */}

            <div className="flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-green-500">
              <input
                type="text"
                aria-label="Buscar por nombre o código de barras"
                placeholder="Buscar por nombre o código de barras…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setScanStatus(""); }}
                className="min-w-0 flex-1 rounded-xl bg-transparent px-4 py-3 outline-none"
              />
              <button
                type="button"
                aria-label="Escanear código de barras"
                title="Escanear código de barras"
                disabled={loading || !!error || !sucursalActiva}
                className="mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-50 focus-visible:outline-2 disabled:opacity-50 lg:hidden [@media(pointer:coarse)]:inline-flex"
                onClick={() => { setScanStatus(""); setCameraOpen(true); }}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" className="size-6">
                  <path d="M3 7h4l2-3h6l2 3h4a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </button>
            </div>
            {scanStatus && <p role="status" className="mt-2 text-sm text-slate-700">{scanStatus}</p>}
            {cameraOpen && <BarcodeCamera onClose={() => setCameraOpen(false)} onCode={procesarEscaneo} />}

            {/* ERROR */}

            {error && (
              <div className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">
                Error de Supabase: {error}
              </div>
            )}

            {/* CARGANDO */}

            {loading && (
              <p className="mt-8 text-slate-500">
                Cargando productos...
              </p>
            )}

            {!loading && !error && (
              <>
                <div className="mb-4 mt-8 flex items-center justify-between">
                  <h2 className="text-lg font-bold">
                    Productos
                  </h2>

                  <span className="text-sm text-slate-500">
                    {productosFiltrados.length} productos
                  </span>
                </div>

                {productosFiltrados.length === 0 ? (
                  <div className="rounded-2xl bg-white p-8 shadow-sm">
                    <p className="text-slate-500">
                      No se encontraron productos.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">

                    {productosFiltrados.map((product) => {
                      const cartItem = cart.find(
                        (item) => item.id === product.id
                      );

                      const cantidadEnCarrito =
                        cartItem?.quantity ?? 0;

                      const sinStockDisponible =
                        cantidadEnCarrito >= product.stock;

                      return (
                        <div
                          key={product.id}
                          className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-4">

                            <div>
                              <h3 className="font-bold">
                                {product.name}
                              </h3>

<p className="mt-1 text-sm text-slate-500">
  Stock:{" "}
  {product.sale_unit === "kg"
    ? `${product.stock.toFixed(3)} kg`
    : `${product.stock} ${product.stock === 1 ? "pieza" : "piezas"}`}
</p>
                            </div>

<div className="text-right">
  <p className="font-bold">
    {formatoDinero(Number(product.sale_price))}
  </p>

  <p className="text-xs text-slate-400">
    {product.sale_unit === "kg" ? "por kg" : "por pieza"}
  </p>
</div>
                          </div>

                          <button
                            onClick={() =>
                              agregarProducto(product)
                            }
                            disabled={
                              product.stock <= 0 ||
                              sinStockDisponible
                            }
                            className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            {product.stock <= 0
                              ? "Sin existencias"
                              : sinStockDisponible
                              ? "Stock máximo"
                              : cantidadEnCarrito > 0
                              ? `Agregar otro (${cantidadEnCarrito})`
                              : "Agregar"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </section>

          {/* ===================== */}
          {/* CARRITO */}
          {/* ===================== */}

          <aside className="hidden lg:block">
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm lg:sticky lg:top-8">

              {/* HEADER CARRITO */}

              <div className="flex items-center justify-between border-b border-slate-100 p-6">

                <div>
                  <h2 className="text-xl font-bold">
                    Carrito
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    {totalProductos === 1
                      ? "1 producto"
                      : `${totalProductos} productos`}
                  </p>
                </div>

                {cart.length > 0 && (
                  <button
                    onClick={vaciarCarrito}
                    className="text-sm font-medium text-red-600 hover:text-red-700"
                  >
                    Vaciar
                  </button>
                )}
              </div>

              {/* CARRITO VACÍO */}

              {cart.length === 0 ? (
                <div className="p-10 text-center">

                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-xl">
                    🛒
                  </div>

                  <p className="mt-4 font-medium">
                    Tu carrito está vacío
                  </p>

                  <p className="mt-1 text-sm text-slate-500">
                    Agrega productos para comenzar
                  </p>
                </div>
              ) : (
                <>

                  {/* ITEMS */}

                  <div className="divide-y divide-slate-100">

                    {cart.map((item) => (
                      <div
                        key={item.id}
                        className="p-5"
                      >
                        <div className="flex justify-between gap-4">

                          <div>
                            <h3 className="font-semibold">
                              {item.name}
                            </h3>

<p className="mt-1 text-sm text-slate-500">
  {formatoDinero(Number(item.sale_price))}{" "}
  {item.sale_unit === "kg" ? "por kg" : "por pieza"}
</p>
                          </div>

                          <button
                            onClick={() =>
                              eliminarProducto(item.id)
                            }
                            className="h-fit text-sm text-red-500 hover:text-red-700"
                          >
                            Eliminar
                          </button>
                        </div>

                        <div className="mt-4 flex items-center justify-between">

                          {/* CONTADOR */}

<div className="flex items-center rounded-xl border border-slate-200">
  <button
    type="button"
    onClick={() => disminuirCantidad(item.id)}
    className="px-4 py-2 text-lg"
  >
    −
  </button>

{item.sale_unit === "kg" ? (
<input
  type="text"
  inputMode="decimal"
  value={cantidadesKg[item.id] ?? String(item.quantity)}
  onChange={(e) => {
    const texto = e.target.value.replace(",", ".");

    // Permite borrar el campo y escribir hasta 3 decimales.
    if (!/^\d*\.?\d{0,3}$/.test(texto)) {
      return;
    }

    setCantidadesKg((actual) => ({
      ...actual,
      [item.id]: texto,
    }));

    // Estados temporales válidos mientras el usuario escribe.
    if (texto === "" || texto === ".") {
      return;
    }

    const valor = Number(texto);

    if (
      !Number.isFinite(valor) ||
      valor <= 0 ||
      valor > item.stock
    ) {
      return;
    }

    setCart((currentCart) =>
      currentCart.map((cartItem) =>
        cartItem.id === item.id
          ? {
              ...cartItem,
              quantity: valor,
            }
          : cartItem
      )
    );
  }}
  onBlur={() => {
    setCantidadesKg((actual) => {
      const nuevo = { ...actual };
      delete nuevo[item.id];
      return nuevo;
    });
  }}
  className="w-20 border-0 bg-transparent text-center font-semibold outline-none"
/>

  ) : (
    <span className="min-w-10 text-center font-semibold">
      {item.quantity}
    </span>
  )}

  <button
    type="button"
    onClick={() => aumentarCantidad(item.id)}
    disabled={item.quantity >= item.stock}
    className="px-4 py-2 text-lg disabled:text-slate-300"
  >
    +
  </button>
</div>

                          {/* SUBTOTAL */}

                          <p className="font-bold">
                            {formatoDinero(
                              Number(item.sale_price) *
                                item.quantity
                            )}
                          </p>
                        </div>

                        {item.quantity >= item.stock && (
                          <p className="mt-2 text-xs text-amber-600">
                            Máximo disponible en inventario
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* TOTAL */}

                  <div className="border-t border-slate-100 p-6">

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">
                        Productos
                      </span>

                      <span>
                        {totalProductos}
                      </span>
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <span className="text-lg font-bold">
                        Total
                      </span>

                      <span className="text-2xl font-bold">
                        {formatoDinero(total)}
                      </span>
                    </div>

                    {/* COBRAR */}

<button
  onClick={() => {
  setMetodoPago("cash");
  setEfectivoRecibido("");
  setMostrarPago(true);
}}
  className="mt-6 w-full rounded-xl bg-green-600 px-5 py-4 text-lg font-semibold text-white"
>
  Cobrar {formatoDinero(total)}
</button>

<p className="mt-3 text-center text-xs text-slate-400">
  La venta se registrará y actualizará el inventario
</p>
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>

    {/* BARRA CARRITO MÓVIL */}
{cart.length > 0 && (
  <div className="fixed bottom-4 left-4 right-4 z-40 lg:hidden">
    <button
      type="button"
      onClick={() => setMostrarCarritoMovil(true)}
      className="flex w-full items-center justify-between rounded-2xl bg-slate-900 px-5 py-4 text-white shadow-2xl"
    >
      <div className="flex items-center gap-3">
        <span className="text-xl">🛒</span>

        <div className="text-left">
          <p className="font-semibold">
            {totalProductos === 1
              ? "1 producto"
              : `${totalProductos} productos`}
          </p>

          <p className="text-xs text-slate-300">
            Ver carrito
          </p>
        </div>
      </div>

      <span className="text-lg font-bold">
        {formatoDinero(total)}
      </span>
    </button>
  </div>
)}

{/* CARRITO MÓVIL */}
{mostrarCarritoMovil && (
  <div
    className="fixed inset-0 z-50 flex items-end bg-black/50 lg:hidden"
    onClick={() => setMostrarCarritoMovil(false)}
  >
    <div
      className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* HEADER */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white p-5">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Carrito
          </h2>

          <p className="text-sm text-slate-500">
            {totalProductos === 1
              ? "1 producto"
              : `${totalProductos} productos`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setMostrarCarritoMovil(false)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-600"
        >
          ×
        </button>
      </div>

      {/* PRODUCTOS */}
      <div className="divide-y divide-slate-100">
        {cart.map((item) => (
          <div key={item.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-slate-900">
                  {item.name}
                </h3>

<p className="mt-1 text-sm text-slate-500">
  {formatoDinero(Number(item.sale_price))}{" "}
  {item.sale_unit === "kg" ? "por kg" : "por pieza"}
</p>
              </div>

              <button
                type="button"
                onClick={() => eliminarProducto(item.id)}
                className="text-sm font-medium text-red-500"
              >
                Eliminar
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between">
<div className="flex items-center rounded-lg border border-slate-200">
  <button
    type="button"
    onClick={() => disminuirCantidad(item.id)}
    className="px-3 py-2 text-lg hover:bg-slate-50"
  >
    −
  </button>

{item.sale_unit === "kg" ? (
  <input
    type="text"
    inputMode="decimal"
    value={cantidadesKg[item.id] ?? String(item.quantity)}
    onChange={(e) => {
      const texto = e.target.value.replace(",", ".");

      if (!/^\d*\.?\d{0,3}$/.test(texto)) {
        return;
      }

      setCantidadesKg((actual) => ({
        ...actual,
        [item.id]: texto,
      }));

      if (texto === "" || texto === ".") {
        return;
      }

      const valor = Number(texto);

      if (
        !Number.isFinite(valor) ||
        valor <= 0 ||
        valor > item.stock
      ) {
        return;
      }

      setCart((currentCart) =>
        currentCart.map((cartItem) =>
          cartItem.id === item.id
            ? {
                ...cartItem,
                quantity: valor,
              }
            : cartItem
        )
      );
    }}
    onBlur={() => {
      setCantidadesKg((actual) => {
        const nuevo = { ...actual };
        delete nuevo[item.id];
        return nuevo;
      });
    }}
    className="w-20 border-0 bg-transparent text-center font-medium outline-none"
  />
) : (

    <span className="min-w-10 text-center font-medium">
      {item.quantity}
    </span>
  )}

  <button
    type="button"
    onClick={() => aumentarCantidad(item.id)}
    disabled={item.quantity >= item.stock}
    className="px-3 py-2 text-lg hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
  >
    +
  </button>
</div>

              <p className="font-bold text-slate-900">
                {formatoDinero(
                  Number(item.sale_price) * item.quantity
                )}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* TOTAL Y COBRO */}
      <div className="sticky bottom-0 border-t border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">
            Total
          </span>

          <span className="text-2xl font-bold text-slate-900">
            {formatoDinero(total)}
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            setMostrarCarritoMovil(false);
            setMetodoPago("cash");
            setEfectivoRecibido("");
            setMostrarPago(true);
          }}
          className="mt-4 w-full rounded-xl bg-green-600 px-5 py-4 text-lg font-semibold text-white"
        >
          Cobrar {formatoDinero(total)}
        </button>

        <button
          type="button"
          onClick={() => {
  vaciarCarrito();
  setMostrarCarritoMovil(false);
}}
          className="mt-3 w-full py-2 text-sm font-medium text-red-600"
        >
          Vaciar carrito
        </button>
      </div>
    </div>
  </div>
)}

{mostrarPago && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">

      <div className="mb-6">
        <p className="text-sm font-medium text-green-600">
          FINALIZAR VENTA
        </p>

        <h2 className="mt-1 text-2xl font-bold">
          Cobrar {formatoDinero(total)}
        </h2>

<p className="mt-2 text-sm text-slate-500">
  Selecciona cómo pagará el cliente
</p>
      </div>

      {/* MÉTODO DE PAGO */}

<div className="mb-6">
  <p className="mb-3 text-sm font-medium text-slate-700">
    Método de pago
  </p>

<div className="grid grid-cols-3 gap-3">
  <button
    type="button"
    onClick={() => {
      setMetodoPago("cash");
      setWhatsappTransferencia("");
      setErrorTransferencia("");
    }}
    className={`rounded-xl border p-4 text-left transition ${
      metodoPago === "cash"
        ? "border-green-600 bg-green-50 ring-1 ring-green-600"
        : "border-slate-200 bg-white hover:bg-slate-50"
    }`}
  >
    <div className="text-xl">💵</div>

    <p className="mt-2 font-semibold text-slate-900">
      Efectivo
    </p>

    <p className="mt-1 text-xs text-slate-500">
      Pago en caja
    </p>
  </button>

  <button
    type="button"
    onClick={() => {
      setMetodoPago("card");
      setEfectivoRecibido("");
      setWhatsappTransferencia("");
      setErrorTransferencia("");
    }}
    className={`rounded-xl border p-4 text-left transition ${
      metodoPago === "card"
        ? "border-green-600 bg-green-50 ring-1 ring-green-600"
        : "border-slate-200 bg-white hover:bg-slate-50"
    }`}
  >
    <div className="text-xl">💳</div>

    <p className="mt-2 font-semibold text-slate-900">
      Tarjeta
    </p>

    <p className="mt-1 text-xs text-slate-500">
      Pago con terminal
    </p>
  </button>

  <button
    type="button"
    onClick={() => {
      setMetodoPago("transfer");
      setEfectivoRecibido("");
      setErrorTransferencia("");
    }}
    disabled={!paymentSettings?.transfer_enabled}
    className={`rounded-xl border p-4 text-left transition ${
      metodoPago === "transfer"
        ? "border-green-600 bg-green-50 ring-1 ring-green-600"
        : "border-slate-200 bg-white hover:bg-slate-50"
    } ${
      !paymentSettings?.transfer_enabled
        ? "cursor-not-allowed opacity-40"
        : ""
    }`}
  >
    <div className="text-xl">🏦</div>

    <p className="mt-2 font-semibold text-slate-900">
      Transferencia
    </p>

    <p className="mt-1 text-xs text-slate-500">
      {!paymentSettings?.transfer_enabled
        ? "No disponible"
        : "Transferencia bancaria"}
    </p>
  </button>
</div>

{metodoPago === "cash" && (
  <>
    <label className="text-sm font-medium text-slate-700">
      Efectivo recibido
    </label>

<input
  type="text"
  inputMode="decimal"
  autoFocus
  value={efectivoRecibido}
  onChange={(e) => {
    const valor = e.target.value;

    if (/^\d*\.?\d{0,2}$/.test(valor)) {
      setEfectivoRecibido(valor);
    }
  }}
  placeholder="0.00"
  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-4 text-2xl font-bold outline-none focus:border-green-500"
/>

      <div className="mt-4">
  <p className="mb-2 text-sm font-medium text-slate-500">
    Pago rápido
  </p>

  <div className="grid grid-cols-3 gap-2">
    {[20, 50, 100, 200, 500].map((billete) => (
      <button
        key={billete}
        type="button"
        onClick={() => {
          const actual = Number(efectivoRecibido) || 0;
          setEfectivoRecibido(String(actual + billete));
        }}
        className="rounded-xl border border-slate-200 bg-white px-3 py-3 font-semibold text-slate-700 transition hover:border-green-500 hover:bg-green-50 active:scale-95"
      >
        ${billete}
      </button>
    ))}

    <button
      type="button"
      onClick={() => setEfectivoRecibido("")}
      className="rounded-xl border border-slate-200 px-3 py-3 font-medium text-slate-500 transition hover:bg-slate-50"
    >
      Limpiar
    </button>
  </div>
</div>

      <div className="mt-6 rounded-xl bg-slate-50 p-4">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Total</span>
          <span className="font-semibold">
            {formatoDinero(total)}
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-slate-500">Cambio</span>
          <span className="text-xl font-bold">
            {formatoDinero(cambio)}
          </span>
        </div>
      </div>

      {efectivoInsuficiente && (
        <p className="mt-3 text-sm font-medium text-red-600">
          El efectivo recibido es insuficiente.
        </p>
      )}
        </>
)}

{metodoPago === "transfer" && (
  <div className="mt-6">
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-semibold text-slate-900">
        Enviar datos de transferencia
      </p>

      <p className="mt-1 text-sm text-slate-500">
        Escribe el WhatsApp del cliente para enviarle los
        datos bancarios y el monto exacto.
      </p>

      <label className="mt-4 block text-sm font-medium text-slate-700">
        WhatsApp del cliente
      </label>

      <div className="mt-2 flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-green-500">
        <span className="border-r border-slate-200 px-4 py-3 font-semibold text-slate-500">
          +52
        </span>

        <input
          type="tel"
          inputMode="numeric"
          value={whatsappTransferencia}
          onChange={(e) => {
            setWhatsappTransferencia(
              e.target.value
                .replace(/\D/g, "")
                .slice(0, 10)
            );

            setErrorTransferencia("");
          }}
          placeholder="5512345678"
          className="min-w-0 flex-1 bg-transparent px-4 py-3 outline-none"
        />
      </div>

      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-slate-400">
          Número mexicano de 10 dígitos
        </p>

        <p
          className={`text-xs font-semibold ${
            whatsappTransferencia.length === 10
              ? "text-green-600"
              : "text-slate-400"
          }`}
        >
          {whatsappTransferencia.length}/10
        </p>
      </div>

      {errorTransferencia && (
        <p className="mt-3 text-sm font-medium text-red-600">
          {errorTransferencia}
        </p>
      )}

      <button
        type="button"
        onClick={enviarDatosTransferencia}
        disabled={whatsappTransferencia.length !== 10}
        className="mt-4 w-full rounded-xl bg-green-600 px-4 py-3 font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Enviar datos por WhatsApp
      </button>
    </div>

    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">
        Confirma la transferencia antes de registrar la venta
      </p>

      <p className="mt-1 text-xs leading-5 text-amber-700">
        Enviar los datos por WhatsApp no registra la venta.
        Cuando hayas confirmado que recibiste el pago, pulsa
        el botón de confirmar.
      </p>
    </div>
  </div>
)}

<button
  type="button"
  onClick={async () => {
    await cobrarVenta();
    setEfectivoRecibido("");
  }}
  disabled={
    metodoPago === "cash" &&
    (efectivoInsuficiente || efectivo <= 0)
  }
  className="mt-6 w-full rounded-xl bg-green-600 px-5 py-4 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
>
  {metodoPago === "cash"
    ? "Confirmar cobro"
    : metodoPago === "transfer"
    ? `Confirmar transferencia ${formatoDinero(total)}`
    : `Confirmar pago ${formatoDinero(total)}`}
</button>

<button
  onClick={() => {
    setMostrarPago(false);
    setEfectivoRecibido("");
  }}
  className="mt-3 w-full rounded-xl px-5 py-3 font-medium text-slate-500 hover:bg-slate-50"
>
  Cancelar
</button>

</div>

    </div>
  </div>
)}
{/* ========================= */}
{/* TICKET VENTA COMPLETADA */}
{/* ========================= */}

{ventaCompletada && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">

      {/* ÉXITO */}
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl text-green-600">
          ✓
        </div>

        <h2 className="mt-4 text-2xl font-bold text-slate-900">
          Venta completada
        </h2>

        <p className="mt-1 text-sm text-slate-500">
          {ventaCompletada.number}
        </p>
      </div>

      {/* PRODUCTOS */}
      <div className="mt-6 border-y border-slate-200 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Productos
        </p>

        <div className="space-y-3">
          {ventaCompletada.items.map((item: any) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-4"
            >
              <div>
                <p className="font-medium text-slate-900">
                  {item.name}
                </p>

<p className="text-sm text-slate-500">
  {item.sale_unit === "kg"
    ? `${Number(item.quantity).toFixed(3)} kg`
    : `${item.quantity} ${item.quantity === 1 ? "pieza" : "piezas"}`}
  {" × "}
  {formatoDinero(Number(item.sale_price))}
  {item.sale_unit === "kg" ? "/kg" : "/pieza"}
</p>
              </div>

              <p className="font-semibold text-slate-900">
                {formatoDinero(
                  Number(item.sale_price) * item.quantity
                )}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* TOTALES */}
      <div className="mt-5 space-y-3">
        <div className="flex justify-between text-slate-600">
          <span>Total</span>
          <span className="font-semibold text-slate-900">
            {formatoDinero(ventaCompletada.total)}
          </span>
        </div>

{ventaCompletada.payment_method === "cash" ? (
  <>
    <div className="flex items-center justify-between">
      <span className="text-slate-600">
        Efectivo
      </span>

      <span className="text-slate-600">
        ${ventaCompletada.paid_amount.toFixed(2)}
      </span>
    </div>

    <div className="flex items-center justify-between border-t border-slate-200 pt-4">
      <span className="font-semibold text-slate-900">
        Cambio
      </span>

      <span className="font-bold text-green-600">
        ${ventaCompletada.change_due.toFixed(2)}
      </span>
    </div>
  </>
) : (
  <>
    <div className="flex items-center justify-between">
      <span className="text-slate-600">
        Método
      </span>

      <span className="font-medium text-slate-900">
        {ventaCompletada.payment_method === "card"
          ? "Tarjeta"
          : "Transferencia"}
      </span>
    </div>

    <div className="flex items-center justify-between border-t border-slate-200 pt-4">
      <span className="font-semibold text-slate-900">
        Pagado
      </span>

      <span className="font-bold text-slate-900">
        ${ventaCompletada.paid_amount.toFixed(2)}
      </span>
    </div>
  </>
)}

      </div>

      {/* BOTONES */}
      <div className="mt-6 space-y-3">
        <button
onClick={() => {
  setVentaCompletada(null);
  setEfectivoRecibido("");
  setWhatsappTransferencia("");
  setErrorTransferencia("");
}}
          className="w-full rounded-xl bg-green-600 px-5 py-4 text-lg font-semibold text-white transition hover:bg-green-700"
        >
          Nueva venta
        </button>

{whatsappTransferencia.length === 10 && (
  <button
    type="button"
    onClick={enviarTicketWhatsApp}
    className="w-full rounded-xl bg-green-600 px-5 py-3 font-semibold text-white transition hover:bg-green-700"
  >
    Enviar ticket por WhatsApp
  </button>
)}

        <button
          onClick={() => window.print()}
          className="w-full rounded-xl bg-slate-100 px-5 py-3 font-medium text-slate-700 transition hover:bg-slate-200"
        >
          Imprimir ticket
        </button>
      </div>

    </div>
  </div>
)}
    </>
  );
}