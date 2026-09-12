import type { ReactElement } from "react";

/**
 * QR code estático (matriz pré-computada) apontando para o Instagram da loja.
 * Sem dependência externa e sem chamada de rede — funciona offline, inclusive
 * na hora da impressão térmica. Se o @ do Instagram mudar, gerar nova matriz.
 */
const QR_URL = "https://www.instagram.com/hotboxbatata/";
const QR_MATRIX: string[] = [
  "11111110001000010011001111111",
  "10000010000100110000001000001",
  "10111010010010001101101011101",
  "10111010001010110010001011101",
  "10111010010011111110101011101",
  "10000010100101110111001000001",
  "11111110101010101010101111111",
  "00000000010010110110100000000",
  "10010110101001000001010100000",
  "00011101001100001000111001001",
  "01100010010010001001001001110",
  "00100000110111010011100110110",
  "01111010010010101110111001011",
  "00111100110001000001110100000",
  "10110110111011101000010001111",
  "00001101111010000110011001010",
  "11010010001011000101010100010",
  "00101001000011101100001101001",
  "10011111001110101010001100011",
  "00010100101000111101100000011",
  "10100010000100010000111110100",
  "00000000110110101001100010111",
  "11111110011110001100101010010",
  "10000010101010101010100011101",
  "10111010000000011100111110011",
  "10111010101111000111001011110",
  "10111010001000101100010011101",
  "10000010000000000101100010010",
  "11111110100111100100100110010"
];

export function InstagramQrCode({ size = 96, className = "" }: { size?: number; className?: string }) {
  const n = QR_MATRIX.length;
  const cells: ReactElement[] = [];

  for (let y = 0; y < n; y++) {
    const row = QR_MATRIX[y];
    let x = 0;
    while (x < n) {
      if (row[x] === "1") {
        let runEnd = x;
        while (runEnd < n && row[runEnd] === "1") runEnd++;
        cells.push(
          <rect key={`${y}-${x}`} x={x} y={y} width={runEnd - x} height={1} fill="#000" shapeRendering="crispEdges" />,
        );
        x = runEnd;
      } else {
        x++;
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={`QR code para ${QR_URL}`}
    >
      <rect x={0} y={0} width={n} height={n} fill="#fff" />
      {cells}
    </svg>
  );
}
