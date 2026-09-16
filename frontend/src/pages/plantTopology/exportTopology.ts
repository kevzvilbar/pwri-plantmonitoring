/**
 * exportTopology.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Utilities for capturing and exporting the plant P&ID schematic as SVG or
 * high-resolution PNG.
 *
 * Captures the entire schematic at 100% scale (0, 0 to maxX, maxY + 24)
 * regardless of the operator's current zoom level or pan/scroll position.
 */

export interface ExportTopologyOptions {
  svgElement: SVGSVGElement;
  plantName: string;
  maxX: number;
  maxY: number;
  scale?: number;
}

/**
 * Normalizes an SVG element clone into a pristine, stand-alone vector document
 * with explicit dimensions, namespaces, and CSS rules embedded.
 */
function prepareStandaloneSvg(svgElement: SVGSVGElement, maxX: number, maxY: number): SVGSVGElement {
  const clone = svgElement.cloneNode(true) as SVGSVGElement;

  const totalW = Math.max(maxX, 400);
  const totalH = Math.max(maxY + 24, 300);

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', `${totalW}`);
  clone.setAttribute('height', `${totalH}`);
  clone.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);

  // Find the outermost scaling wrapper <g transform="scale(...)"> and reset it to scale(1)
  const topG = clone.querySelector('g[transform^="scale("]');
  if (topG) {
    topG.setAttribute('transform', 'scale(1)');
  }

  return clone;
}

/**
 * Exports the plant topology schematic as a clean vector .svg file.
 */
export function exportTopologyAsSvg({ svgElement, plantName, maxX, maxY }: ExportTopologyOptions): void {
  const clone = prepareStandaloneSvg(svgElement, maxX, maxY);
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);

  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const safeName = (plantName || 'Plant').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const filename = `${safeName}-topology.svg`;

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exports the plant topology schematic as a high-resolution raster .png image.
 * Uses 2x or 3x device pixel scaling for crisp presentation in reports and slides.
 */
export function exportTopologyAsPng({ svgElement, plantName, maxX, maxY, scale = 2 }: ExportTopologyOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const clone = prepareStandaloneSvg(svgElement, maxX, maxY);
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(clone);

      const totalW = Math.max(maxX, 400);
      const totalH = Math.max(maxY + 24, 300);

      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = totalW * scale;
        canvas.height = totalH * scale;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('Failed to create canvas 2D rendering context'));
          return;
        }

        // Dark background matching industrial SCADA / card aesthetic
        ctx.fillStyle = '#0f172a'; // slate-900 / card dark background
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob((pngBlob) => {
          URL.revokeObjectURL(url);
          if (!pngBlob) {
            reject(new Error('Failed to generate PNG blob'));
            return;
          }

          const pngUrl = URL.createObjectURL(pngBlob);
          const safeName = (plantName || 'Plant').toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const filename = `${safeName}-topology.png`;

          const link = document.createElement('a');
          link.href = pngUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(pngUrl);
          resolve();
        }, 'image/png');
      };

      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };

      img.src = url;
    } catch (err) {
      reject(err);
    }
  });
}

