import { nombreRol } from "@/lib/roles";

type VentaTicket = {
  number: string;
  total: number;
  paid_amount: number;
  change_due: number;
  payment_method: "cash" | "card" | "transfer";
  created_at: string;

  user_name: string | null;
  user_role: "admin" | "manager" | "cashier" | null;
};

type ProductoTicket = { name: string; quantity: number; unit_price: number; sale_unit?: "piece" | "kg" };

function escapar(texto: string) {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

export function imprimirTicket(negocio: string, venta: VentaTicket, itemsVenta: ProductoTicket[]) {
const metodoPago =
  venta.payment_method === "card"
    ? "Tarjeta"
    : venta.payment_method === "transfer"
    ? "Transferencia"
    : "Efectivo";

const rolUsuario = venta.user_role
  ? nombreRol(venta.user_role)
  : "";

const atendio = venta.user_name
  ? rolUsuario
    ? `${venta.user_name} · ${rolUsuario}`
    : venta.user_name
  : "—";

  const ventana = window.open(
    "",
    "_blank",
    "width=420,height=700"
  );

  if (!ventana) {
    alert(
      "El navegador bloqueó la ventana del ticket. Permite ventanas emergentes e inténtalo de nuevo."
    );
    return;
  }

  const productosHTML = itemsVenta
    .map((item) => {
      const subtotal =
        Number(item.unit_price) *
        Number(item.quantity);

      return `
        <div class="producto">
          <div class="fila">
            <span>${escapar(item.name)}</span>
            <span>${formatoDinero(subtotal)}</span>
          </div>

          <div class="detalle">
            ${item.quantity}${item.sale_unit === "kg" ? " kg" : ""} × ${formatoDinero(
              Number(item.unit_price)
            )}
          </div>
        </div>
      `;
    })
    .join("");

  ventana.document.write(`
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="UTF-8" />

        <title>Ticket ${escapar(venta.number)}</title>

        <style>
          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 24px;
            font-family: Arial, sans-serif;
            color: #111;
            background: white;
          }

          .ticket {
            width: 100%;
            max-width: 360px;
            margin: 0 auto;
          }

          .centrado {
            text-align: center;
          }

          h1 {
            margin: 0;
            font-size: 22px;
          }

          .subtitulo {
            margin-top: 5px;
            font-size: 12px;
            color: #555;
          }

          .separador {
            border-top: 1px dashed #999;
            margin: 18px 0;
          }

          .fila {
            display: flex;
            justify-content: space-between;
            gap: 16px;
          }

          .producto {
            margin-bottom: 14px;
          }

          .detalle {
            margin-top: 3px;
            font-size: 12px;
            color: #555;
          }

          .total {
            font-size: 18px;
            font-weight: bold;
          }

          .linea {
            margin-bottom: 8px;
          }

          .gracias {
            margin-top: 24px;
            text-align: center;
            font-size: 12px;
          }

          @media print {
            body {
              padding: 0;
            }
          }
        </style>
      </head>

      <body>
        <div class="ticket">

          <div class="centrado">
            <h1>${escapar(negocio)}</h1>

            <div class="subtitulo">
              Ticket de venta
            </div>

            <div class="subtitulo">
              ${escapar(venta.number)}
            </div>

            <div class="subtitulo">
              ${formatoFecha(venta.created_at)}
            </div>

            <div class="subtitulo">
  Método: ${metodoPago}
</div>

<div class="subtitulo">
  Atendió: ${escapar(atendio)}
</div>

          </div>

          <div class="separador"></div>

          ${productosHTML}

          <div class="separador"></div>

          <div class="fila linea total">
            <span>TOTAL</span>
            <span>
              ${formatoDinero(Number(venta.total))}
            </span>
          </div>

${
  venta.payment_method === "cash"
    ? `
      <div class="fila linea">
        <span>Efectivo recibido</span>
        <span>
          ${formatoDinero(Number(venta.paid_amount))}
        </span>
      </div>

      <div class="fila linea">
        <span>Cambio</span>
        <span>
          ${formatoDinero(Number(venta.change_due))}
        </span>
      </div>
    `
    : venta.payment_method === "transfer"
    ? `
      <div class="fila linea">
        <span>Pago por transferencia</span>
        <span>
          ${formatoDinero(Number(venta.total))}
        </span>
      </div>
    `
    : `
      <div class="fila linea">
        <span>Pago con tarjeta</span>
        <span>
          ${formatoDinero(Number(venta.total))}
        </span>
      </div>
    `
}

          <div class="gracias">
            ¡Gracias por su compra!
          </div>

        </div>

        <script>
          window.onload = function () {
            window.print();
          };
        </script>
      </body>
    </html>
  `);

  ventana.document.close();
}

