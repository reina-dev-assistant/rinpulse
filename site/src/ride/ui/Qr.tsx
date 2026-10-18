import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** QR as one SVG path: dark modules on a white tile with a quiet zone, which is what phone scanners need. */
export function Qr({ text, label }: { text: string; label: string }) {
  const { path, size } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (qr.isDark(y, x)) d += `M${x + 2} ${y + 2}h1v1h-1z`;
      }
    }
    return { path: d, size: count + 4 };
  }, [text]);

  return (
    <svg className="rd-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#101211" />
    </svg>
  );
}
