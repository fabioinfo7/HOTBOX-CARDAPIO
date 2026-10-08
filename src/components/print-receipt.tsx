import { brl, formatPhone } from "@/lib/formatters";
import { HOTBOX_LOGO_BASE64 } from "@/assets/hotbox-logo-base64";
import { InstagramQrCode } from "@/components/instagram-qr-code";

type Item = {
  id?: string;
  quantity: number;
  product_name: string;
  unit_price: number;
  notes?: string | null;
};

type Order = {
  order_number?: number | string | null;
  external_display_id?: string | null;
  source?: string | null;
  created_at: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_complement?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_reference?: string | null;
  subtotal?: number | null;
  delivery_fee?: number | null;
  total?: number | null;
  payment_method?: string | null;
  notes?: string | null;
};

const dateOnly = (d: string) => {
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
};

const timeOnly = (d: string) => {
  const dt = new Date(d);
  return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
};

const payLabel = (m?: string | null) => {
  if (m === "pix") return "PIX";
  if (m === "cash" || m === "dinheiro") return "DINHEIRO";
  if (m === "card" || m === "cartao" || m === "credit" || m === "debit") return "CARTÃO";
  if (m === "link") return "LINK DE PAGAMENTO";
  if (!m) return "—";
  return m.toUpperCase();
};

/** Comprovante térmico — bobina 80mm, área útil 72mm. Só aparece na impressão. */
export function PrintReceipt({
  order,
  items,
  businessHoursText,
}: {
  order: Order;
  items: Item[];
  businessHoursText?: string | null;
}) {
  const ref =
    order.source === "ifood" || order.source === "99food"
      ? order.external_display_id || "—"
      : `#${order.order_number ?? "—"}`;

  const addressLine1 = [order.address_street, order.address_number].filter(Boolean).join(", ");
  const addressLine2 = [order.address_neighborhood, order.address_city].filter(Boolean).join(" - ");
  const hasAddress = Boolean(addressLine1 || addressLine2);

  return (
    <div className="print-58mm">
      <div className="receipt">
        <div className="logo-container">
          <img src={HOTBOX_LOGO_BASE64} alt="HotBox Delivery" className="logo" />
        </div>

        <hr className="solid-divider" />

        <div className="order-header">
          <span className="order-number">Pedido {ref}</span>
          <span className="order-date">
            {dateOnly(order.created_at)} — {timeOnly(order.created_at)}
          </span>
        </div>

        <hr className="divider" />

        <div className="customer-section">
          <div className="customer-row">
            <span className="label">Cliente: </span>
            <span className="customer-name">{order.customer_name || "—"}</span>
          </div>
          {order.customer_phone && (
            <div className="customer-row">
              <span className="label">Tel.: </span>
              {formatPhone(order.customer_phone)}
            </div>
          )}
          {hasAddress && (
            <div className="customer-row">
              <span className="label">Endereço: </span>
              {addressLine1}
              {addressLine2 ? ` — ${addressLine2}` : ""}
              {order.address_complement ? ` (${order.address_complement})` : ""}
              {order.address_reference ? ` Ref.: ${order.address_reference}` : ""}
            </div>
          )}
        </div>

        <hr className="divider" />

        <div className="section-title">Itens</div>
        <div className="items-list">
          {items.map((i, idx) => (
            <div className="item" key={i.id ?? idx}>
              <div className="item-main">
                <span className="item-description">
                  {i.quantity}x {i.product_name}
                </span>
                <span className="item-price">{brl(i.unit_price * i.quantity)}</span>
              </div>
              {i.notes && <div className="item-observation">{i.notes}</div>}
            </div>
          ))}
        </div>

        <hr className="divider" />

        <div className="summary-section">
          <div className="section-title">Resumo</div>
          <div className="summary-row">
            <span>Subtotal</span>
            <span>{brl(order.subtotal)}</span>
          </div>
          <div className="summary-row">
            <span>Entrega</span>
            <span>{brl(order.delivery_fee)}</span>
          </div>
          <div className="summary-row summary-total">
            <span>Total</span>
            <span>{brl(order.total)}</span>
          </div>
        </div>

        <hr className="divider" />

        <div className="compact-row">
          <span className="label">Pagamento: </span>
          {payLabel(order.payment_method)}
        </div>

        {order.notes && (
          <div className="compact-row">
            <span className="label">Obs.: </span>
            {order.notes}
          </div>
        )}

        {businessHoursText && (
          <div className="compact-row">
            <span className="label">Atendimento: </span>
            {businessHoursText}
          </div>
        )}

        <hr className="divider" />

        <div className="footer">
          <div className="ifood-message">Estamos também no iFood</div>
          <div className="instagram-box">Instagram: @HOTBOXBATATA</div>
          <div className="whatsapp">WhatsApp: (21) 98429-6288</div>
          <div className="thanks">Obrigado pela preferência! Volte sempre!</div>
        </div>

        <div className="qr-section">
          <div className="qr-title">Aponte a câmera e siga a HotBox</div>
          <div id="qrcode">
            <InstagramQrCode size={94} />
          </div>
          <div className="qr-description">Siga-nos no Instagram para receber nossas promoções semanais</div>
        </div>

        <hr className="divider final-divider" />
      </div>
    </div>
  );
}
