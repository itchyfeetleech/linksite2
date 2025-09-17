import qrcode from 'qrcode-generator';

export interface QrOptions {
  size?: number;
  margin?: number;
  color?: string;
  background?: string;
  ariaLabel?: string;
}

const DEFAULT_ERROR_CORRECTION_LEVEL: Parameters<typeof qrcode>[1] = 'M';
const MIN_CELL_SIZE = 2;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const createQrSvg = (value: string, options: QrOptions = {}): string => {
  const normalized = value?.trim() ?? '';
  const qr = qrcode(0, DEFAULT_ERROR_CORRECTION_LEVEL);
  qr.addData(normalized || ' ');
  qr.make();

  const moduleCount = qr.getModuleCount();
  const margin = Math.max(0, Math.floor(options.margin ?? 8));
  const requestedSize = Math.max(moduleCount, Math.floor(options.size ?? 160));
  const cellSize = Math.max(MIN_CELL_SIZE, Math.floor((requestedSize - margin * 2) / moduleCount));
  const totalSize = cellSize * moduleCount + margin * 2;
  const color = options.color ?? '#22ff88';
  const background = options.background ?? 'transparent';
  const ariaLabel = escapeHtml(options.ariaLabel ?? 'QR code');

  let path = '';
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qr.isDark(row, col)) {
        continue;
      }

      const x = margin + col * cellSize;
      const y = margin + row * cellSize;
      path += `M${x} ${y}h${cellSize}v${cellSize}h-${cellSize}z`;
    }
  }

  const cornerRadius = Math.max(4, Math.floor(cellSize * 1.5));
  const backgroundRect = `<rect width="${totalSize}" height="${totalSize}" fill="${background}" rx="${cornerRadius}" ry="${cornerRadius}" />`;
  const qrPath = `<path d="${path}" fill="${color}" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" role="img" aria-label="${ariaLabel}" shape-rendering="crispEdges">${backgroundRect}${qrPath}</svg>`;
};

export default createQrSvg;
