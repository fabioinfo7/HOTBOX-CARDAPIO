import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/bio")({
  component: BioPage,
});

const WHATSAPP_NUMBER = "552184296288";
const WHATSAPP_MSG = encodeURIComponent(
  "Olá, vim pelo Instagram e gostaria de saber sobre as batatas recheadas."
);
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MSG}`;
const IFOOD_URL =
  "https://www.ifood.com.br/delivery/duque-de-caxias-rj/hotbox-delivery-jardim-gramacho/812f264d-658d-4e54-88d1-ac4f6d040916";
const NFOOD_URL = "https://oia.99app.com/dlp9/3SsCkm?area=BR";

const BAIRROS_ZAP = [
  "Chacrinha",
  "Copacabana",
  "Corte 8",
  "Doutor Laureano",
  "Dr. Laureano",
  "Gramacho",
  "Itatiaia",
  "Jardim Gramacho",
  "Parque Duque",
  "Paulicéia",
  "Sarapuí",
  "Vila Leopoldina",
  "Vila São Luís",
];

const WhatsAppIcon = () => (
  <svg
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    width="32"
    height="32"
    aria-hidden="true"
  >
    <circle cx="24" cy="24" r="24" fill="#25D366" />
    <path
      fill="white"
      d="M24 10.5C16.544 10.5 10.5 16.544 10.5 24c0 2.386.638 4.622 1.752 6.557L10.5 37.5l7.197-1.723A13.426 13.426 0 0024 37.5c7.456 0 13.5-6.044 13.5-13.5S31.456 10.5 24 10.5zm6.63 18.677c-.275.774-1.607 1.48-2.196 1.573-.561.088-1.27.125-2.05-.128-.472-.153-1.077-.357-1.848-.698-3.254-1.404-5.379-4.686-5.543-4.902-.163-.216-1.33-1.77-1.33-3.376 0-1.607.842-2.398 1.14-2.726a1.2 1.2 0 01.871-.408c.218 0 .435.004.626.012.2.009.47-.076.735.561.275.655.935 2.262.936 2.435 0 .054-.027.108-.08.161 0 .173-.054.272-.108.38-.108.217-.27.326-.163.597.107.272.48.795.996 1.284.545.516 1.005.84 1.278.948.272.108.435.09.598-.054.163-.144.697-.813.884-1.092.186-.28.372-.233.625-.14.254.094 1.613.76 1.888.898.272.136.454.204.52.317.066.113.066.654-.208 1.357z"
    />
  </svg>
);

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" width="20" height="20" aria-hidden="true">
    <path d="M5 12h13M13 7l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function BioPage() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&display=swap');

        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; min-height: 100%; background: #000; }
        body { overflow-x: hidden; }

        .bio-page {
          --red: #e3151b;
          --orange: #ff9f0a;
          --yellow: #ffc21c;
          --ink: #050505;
          --soft-white: rgba(255,255,255,.72);
          position: relative;
          width: 100%;
          min-height: 100dvh;
          overflow: hidden;
          color: #fff;
          font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background:
            radial-gradient(circle at 18% 54%, rgba(227,21,27,.20), transparent 28%),
            radial-gradient(circle at 84% 62%, rgba(255,159,10,.18), transparent 28%),
            radial-gradient(ellipse at 50% 100%, rgba(112,0,0,.35), transparent 55%),
            linear-gradient(180deg, #000 0 33%, #080606 48%, #0d0504 72%, #050505 100%);
        }

        .bio-page::before {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: .22;
          background-image:
            linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
          background-size: 42px 42px;
          mask-image: linear-gradient(to bottom, transparent 0 28%, #000 54%, #000 100%);
        }

        .bio-shell {
          position: relative;
          z-index: 2;
          width: min(100%, 480px);
          margin: 0 auto;
          padding: 18px 16px 36px;
        }

        .hero {
          position: relative;
          min-height: 315px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          padding-top: 2px;
          isolation: isolate;
        }

        .hero::after {
          content: '';
          position: absolute;
          z-index: -1;
          width: 280px;
          height: 115px;
          left: 50%;
          bottom: 20px;
          transform: translateX(-50%);
          background: radial-gradient(ellipse, rgba(226,22,26,.20), transparent 68%);
          filter: blur(14px);
        }

        .brand-frame {
          position: relative;
          width: min(272px, 72vw);
          height: 205px;
          display: grid;
          place-items: center;
          border-radius: 38px;
          background: #000;
        }

        .brand-frame::before {
          content: '';
          position: absolute;
          inset: auto 12% 1px;
          height: 44px;
          border-radius: 50%;
          background: rgba(228,20,28,.18);
          filter: blur(25px);
        }

        .bio-logo {
          position: relative;
          z-index: 3;
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
          border-radius: 30px;
          mix-blend-mode: normal;
          animation: logo-breathe 5s ease-in-out infinite;
          filter: drop-shadow(0 14px 30px rgba(0,0,0,.48));
        }

        @keyframes logo-breathe {
          0%,100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-5px) scale(1.008); }
        }

        .hero-copy {
          margin-top: 14px;
          text-align: center;
          position: relative;
          z-index: 8;
        }
        .hero-title {
          margin: 13px 0 0;
          font-family: 'Bebas Neue', 'Arial Narrow', sans-serif;
          font-size: clamp(27px, 8vw, 36px);
          line-height: .96;
          font-weight: 400;
          letter-spacing: .8px;
          text-transform: uppercase;
        }
        .hero-title .accent {
          background: linear-gradient(90deg, #ff3a30, #ff9f0a 62%, #ffd02a);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .hero-description {
          margin: 9px auto 0;
          max-width: 330px;
          color: rgba(255,255,255,.46);
          font-size: 11.5px;
          line-height: 1.55;
        }

        .order-section { margin-top: 24px; }
        .section-label {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0 3px 11px;
          color: rgba(255,255,255,.31);
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 1.7px;
          text-transform: uppercase;
        }
        .section-label::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg, rgba(255,255,255,.10), transparent); }

        .order-grid { display: grid; gap: 11px; }
        .order-link {
          position: relative;
          min-height: 76px;
          display: grid;
          grid-template-columns: 54px minmax(0,1fr) 34px;
          gap: 13px;
          align-items: center;
          padding: 10px 13px 10px 11px;
          border-radius: 21px;
          overflow: hidden;
          text-decoration: none;
          color: inherit;
          -webkit-tap-highlight-color: transparent;
          transform: translateZ(0);
          transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease, border-color .22s ease;
        }
        .order-link::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(108deg, transparent 25%, rgba(255,255,255,.11) 48%, transparent 67%);
          transform: translateX(-120%);
          transition: transform .65s ease;
          pointer-events: none;
        }
        .order-link:hover::before { transform: translateX(120%); }
        .order-link:hover { transform: translateY(-3px); }
        .order-link:active { transform: translateY(0) scale(.985); }

        .order-link--whatsapp {
          border: 1px solid rgba(47,214,112,.22);
          background: linear-gradient(135deg, rgba(8,50,32,.94), rgba(8,91,52,.91));
          box-shadow: 0 14px 34px rgba(0,0,0,.22), 0 9px 28px rgba(10,145,78,.10);
        }
        .order-link--ifood {
          color: #1e1e1e;
          border: 1px solid rgba(255,255,255,.84);
          background: linear-gradient(140deg, #fff 0%, #f8f7f5 100%);
          box-shadow: 0 14px 34px rgba(0,0,0,.27), 0 8px 25px rgba(234,29,44,.12);
        }
        .order-link--99 {
          color: #121212;
          border: 1px solid rgba(255,224,47,.66);
          background: linear-gradient(135deg, #ffe400 0%, #ffcf00 70%, #ffb800 100%);
          box-shadow: 0 14px 34px rgba(0,0,0,.28), 0 8px 28px rgba(255,213,0,.10);
        }

        .brand-icon {
          width: 54px;
          height: 54px;
          display: grid;
          place-items: center;
          border-radius: 16px;
          flex-shrink: 0;
        }
        .order-link--whatsapp .brand-icon { background: rgba(0,0,0,.18); }
        .order-link--ifood .brand-icon { background: #fff; box-shadow: inset 0 0 0 1px rgba(0,0,0,.04); }
        .order-link--99 .brand-icon { background: rgba(255,255,255,.32); }
        .brand-icon img { display: block; max-width: 38px; max-height: 38px; object-fit: contain; }
        .brand-icon--ifood img { width: 43px; max-width: 43px; }
        .brand-icon--99 img { width: 38px; height: 38px; }

        .order-copy { min-width: 0; }
        .order-name { font-size: 15px; font-weight: 800; line-height: 1.2; letter-spacing: -.2px; }
        .order-desc { margin-top: 3px; font-size: 10.5px; line-height: 1.35; opacity: .56; }
        .order-link--whatsapp .order-desc { color: rgba(255,255,255,.68); opacity: 1; }

        .order-arrow {
          width: 34px;
          height: 34px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          transition: transform .2s ease;
        }
        .order-link:hover .order-arrow { transform: translateX(3px); }
        .order-link--whatsapp .order-arrow { background: rgba(255,255,255,.08); color: rgba(255,255,255,.72); }
        .order-link--ifood .order-arrow { background: rgba(234,29,44,.08); color: #ea1d2c; }
        .order-link--99 .order-arrow { background: rgba(18,18,18,.08); color: #121212; }

        .delivery-card {
          position: relative;
          margin-top: 15px;
          padding: 16px 15px 14px;
          border-radius: 22px;
          border: 1px solid rgba(255,255,255,.075);
          background: linear-gradient(145deg, rgba(255,255,255,.045), rgba(255,255,255,.018));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 18px 44px rgba(0,0,0,.22);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
        .delivery-head { display: flex; gap: 10px; align-items: flex-start; }
        .delivery-pin {
          width: 31px;
          height: 31px;
          display: grid;
          place-items: center;
          flex: 0 0 31px;
          border-radius: 10px;
          background: rgba(37,211,102,.10);
          color: #46dd80;
          font-size: 14px;
        }
        .delivery-title { font-size: 11px; font-weight: 800; letter-spacing: .2px; }
        .delivery-sub { margin-top: 3px; color: rgba(255,255,255,.38); font-size: 9.5px; line-height: 1.4; }
        .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }
        .chip {
          padding: 5px 8px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.065);
          background: rgba(0,0,0,.22);
          color: rgba(255,255,255,.46);
          font-size: 9px;
          line-height: 1;
        }
        .delivery-foot {
          margin-top: 11px;
          padding-top: 10px;
          border-top: 1px solid rgba(255,255,255,.055);
          color: rgba(255,255,255,.34);
          text-align: center;
          font-size: 9.5px;
          line-height: 1.45;
        }
        .delivery-foot strong { color: rgba(255,190,46,.72); font-weight: 700; }

        .bio-footer {
          margin-top: 26px;
          text-align: center;
          color: rgba(255,255,255,.20);
          font-size: 9px;
          letter-spacing: .45px;
        }
        .bio-footer strong { color: rgba(255,255,255,.34); font-weight: 600; }

        @media (min-width: 680px) {
          .bio-shell { padding-top: 28px; padding-bottom: 54px; }
          .hero { min-height: 340px; }
          .brand-frame { width: 320px; height: 240px; }
        }

        @media (max-width: 390px) {
          .bio-shell { padding-left: 12px; padding-right: 12px; }
          .hero { min-height: 300px; }
          .brand-frame { width: 276px; height: 208px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .bio-logo { animation: none !important; }
          .order-link,
          .order-link::before,
          .order-arrow { transition: none !important; }
        }
      `}</style>

      <main className="bio-page">
        <div className="bio-shell">
          <section className="hero" aria-labelledby="bio-title">
            <div className="brand-frame">
              <img
                src="/images/logo-hotbox.jpeg"
                alt="HotBox Delivery"
                className="bio-logo"
              />
            </div>

            <div className="hero-copy">
              <h1 id="bio-title" className="hero-title">
                <span>Escolha onde pedir e</span><br />
                <span className="accent">Mate sua fome</span>
              </h1>
              <p className="hero-description">
                Recheio de verdade, muito sabor e aquele capricho que transforma uma batata em refeição completa.
              </p>
            </div>
          </section>

          <section className="order-section" aria-label="Canais para fazer seu pedido">
            <div className="section-label">Faça seu pedido</div>

            <div className="order-grid">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="order-link order-link--whatsapp"
              >
                <div className="brand-icon"><WhatsAppIcon /></div>
                <div className="order-copy">
                  <div className="order-name">Peça direto pelo WhatsApp</div>
                  <div className="order-desc">Atendimento direto e fácil para os bairros atendidos</div>
                </div>
                <div className="order-arrow"><ArrowIcon /></div>
              </a>

              <a
                href={IFOOD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="order-link order-link--ifood"
              >
                <div className="brand-icon brand-icon--ifood">
                  <img src="/images/ifood-logo.svg" alt="iFood" />
                </div>
                <div className="order-copy">
                  <div className="order-name">Peça pelo iFood</div>
                  <div className="order-desc">Abra nossa loja no app e escolha seu sabor</div>
                </div>
                <div className="order-arrow"><ArrowIcon /></div>
              </a>

              <a
                href={NFOOD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="order-link order-link--99"
              >
                <div className="brand-icon brand-icon--99">
                  <img
                    src="https://upload.wikimedia.org/wikipedia/commons/3/3c/Logotipo_da_99.svg"
                    alt="99"
                    onError={(event) => {
                      event.currentTarget.src = "/images/99-logo-fallback.svg";
                    }}
                  />
                </div>
                <div className="order-copy">
                  <div className="order-name">Peça pelo 99Food</div>
                  <div className="order-desc">Acesse a HotBox no 99Food e peça pelo aplicativo</div>
                </div>
                <div className="order-arrow"><ArrowIcon /></div>
              </a>
            </div>
          </section>

          <section className="delivery-card" aria-label="Bairros atendidos pelo WhatsApp">
            <div className="delivery-head">
              <div className="delivery-pin" aria-hidden="true">⌖</div>
              <div>
                <div className="delivery-title">Entrega direta pelo WhatsApp</div>
                <div className="delivery-sub">Disponível para os bairros abaixo. Para outras regiões, escolha iFood ou 99Food.</div>
              </div>
            </div>

            <div className="chips">
              {BAIRROS_ZAP.map((bairro) => (
                <span key={bairro} className="chip">{bairro}</span>
              ))}
            </div>

            <div className="delivery-foot">
              Seu bairro não está na lista? <strong>Use iFood ou 99Food</strong> para consultar a entrega pelo aplicativo.
            </div>
          </section>

          <footer className="bio-footer">
            <strong>HotBox Delivery</strong> · Muito sabor em cada pedido 🔥
          </footer>
        </div>
      </main>
    </>
  );
}
