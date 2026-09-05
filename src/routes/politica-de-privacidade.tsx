import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone } from "@/lib/formatters";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/politica-de-privacidade")({
  component: PrivacyPolicyPage,
});

const LAST_UPDATED = "21 de julho de 2026";

function PrivacyPolicyPage() {
  const [storeName, setStoreName] = useState("HotBox Delivery");
  const [whatsapp, setWhatsapp] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  useEffect(() => {
    supabase
      .from("store_config_public")
      .select("*")
      .maybeSingle()
      .then(({ data }) => {
        const d = data as any;
        if (d?.store_name) setStoreName(d.store_name);
        if (d?.whatsapp_number) setWhatsapp(d.whatsapp_number);
        if (d?.privacy_contact_email) setContactEmail(d.privacy_contact_email);
      });
  }, []);

  return (
    <div className="mx-auto min-h-screen max-w-3xl bg-background px-5 py-8 text-sm leading-relaxed text-foreground">
      <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft className="size-4" /> Voltar
      </Link>

      <h1 className="mb-1 text-2xl font-bold tracking-tight">Política de Privacidade</h1>
      <p className="mb-8 text-xs text-muted-foreground">{storeName} • Última atualização: {LAST_UPDATED}</p>

      <div className="space-y-6">
        <section>
          <p>
            Esta Política de Privacidade descreve como a <strong>{storeName}</strong> coleta, usa, armazena e
            protege as informações dos clientes que fazem pedidos pelo nosso site, WhatsApp ou aplicativos de
            delivery parceiros (como iFood e 99Food). Ao fazer um pedido ou conversar com nosso atendimento, você
            concorda com as práticas descritas aqui.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">1. Quais informações coletamos</h2>
          <p className="mb-2">Coletamos apenas os dados necessários para processar seu pedido e melhorar seu atendimento:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Dados de identificação:</strong> nome e número de telefone/WhatsApp.</li>
            <li><strong>Dados de entrega:</strong> endereço completo (rua, número, bairro, complemento, ponto de referência).</li>
            <li><strong>Dados do pedido:</strong> itens escolhidos, observações, forma de pagamento e valor.</li>
            <li><strong>Comprovantes de pagamento:</strong> quando você envia um comprovante de Pix pelo WhatsApp, a imagem é analisada para confirmar o pagamento.</li>
            <li><strong>Histórico de conversa:</strong> mensagens trocadas com nosso atendimento (automático ou humano) pelo WhatsApp, para dar continuidade ao seu pedido e treinar melhorias no atendimento.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">2. Como usamos o WhatsApp e a API oficial da Meta</h2>
          <p>
            Utilizamos o WhatsApp (incluindo a API oficial do WhatsApp Business fornecida pela Meta) para receber
            pedidos, confirmar informações, atualizar o status da sua entrega e enviar comprovantes ou promoções
            relacionadas ao seu pedido. As mensagens trocadas podem ser processadas automaticamente por um sistema
            de atendimento com inteligência artificial, com supervisão humana disponível a qualquer momento. Não
            enviamos mensagens de marketing sem relação com seu pedido sem seu consentimento prévio.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">3. Como usamos suas informações</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Processar, preparar e entregar seu pedido corretamente no endereço informado.</li>
            <li>Confirmar pagamentos via Pix, cartão ou dinheiro.</li>
            <li>Manter você informado sobre o status do pedido (em preparo, saiu para entrega, etc.).</li>
            <li>Organizar a rota e o repasse de valores dos nossos entregadores parceiros.</li>
            <li>Registrar seu histórico de pedidos para agilizar compras futuras.</li>
            <li>Cumprir obrigações legais, fiscais e contratuais com plataformas parceiras (iFood, 99Food).</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">4. Com quem compartilhamos seus dados</h2>
          <p className="mb-2">Não vendemos suas informações pessoais. Compartilhamos dados apenas quando necessário para viabilizar o próprio pedido:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Entregadores:</strong> nome, telefone e endereço de entrega, apenas para o pedido em questão.</li>
            <li><strong>Meta / WhatsApp:</strong> como operadora da plataforma de mensagens usada no atendimento.</li>
            <li><strong>iFood e 99Food:</strong> quando o pedido é originado nessas plataformas, os dados necessários ao cumprimento do pedido trafegam conforme as políticas de privacidade delas.</li>
            <li><strong>Processadores de pagamento:</strong> instituições financeiras envolvidas na confirmação de pagamentos via Pix ou cartão.</li>
            <li><strong>Autoridades públicas:</strong> apenas quando exigido por lei ou ordem judicial.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">5. Por quanto tempo guardamos seus dados</h2>
          <p>
            Mantemos seus dados de pedido e conversa pelo tempo necessário para cumprir finalidades comerciais,
            fiscais e legais, e para melhorar seu atendimento em pedidos futuros. Você pode solicitar a exclusão
            dos seus dados a qualquer momento, conforme descrito na seção 7.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">6. Segurança das informações</h2>
          <p>
            Adotamos medidas técnicas e organizacionais para proteger seus dados contra acesso não autorizado,
            perda ou alteração indevida, incluindo controle de acesso restrito à nossa equipe e armazenamento em
            infraestrutura com criptografia.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">7. Seus direitos (LGPD)</h2>
          <p className="mb-2">
            De acordo com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você tem direito a:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Confirmar se tratamos seus dados e acessá-los;</li>
            <li>Corrigir dados incompletos, inexatos ou desatualizados;</li>
            <li>Solicitar a exclusão dos seus dados pessoais, exceto quando a manutenção for exigida por lei;</li>
            <li>Revogar o consentimento para o uso dos seus dados a qualquer momento;</li>
            <li>Solicitar informações sobre com quem compartilhamos seus dados.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">8. Contato</h2>
          <p>
            Para exercer seus direitos ou tirar dúvidas sobre esta política, fale com a gente:
          </p>
          <ul className="mt-2 list-none space-y-1">
            {whatsapp && <li>📱 WhatsApp: <strong>{formatPhone(whatsapp)}</strong></li>}
            {contactEmail && <li>✉️ E-mail: <strong>{contactEmail}</strong></li>}
            {!whatsapp && !contactEmail && <li>Entre em contato pelos canais informados no nosso site.</li>}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-bold">9. Alterações desta política</h2>
          <p>
            Podemos atualizar esta Política de Privacidade periodicamente para refletir mudanças em nossas
            práticas ou por exigência legal. A data da última atualização está sempre indicada no topo desta
            página.
          </p>
        </section>
      </div>
    </div>
  );
}
