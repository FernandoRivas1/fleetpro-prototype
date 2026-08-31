import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import './SignaturePad.css';

export interface SignaturePadHandle {
  isEmpty: () => boolean;
  clear: () => void;
  /** Full data URL (e.g. "data:image/png;base64,...."). */
  toDataURL: () => string;
}

/** Plain HTML5 canvas + pointer events (touch/stylus/mouse all fire
 * pointer events) — the same approach the design's own Tablet
 * Signature.dc.html hand-rolls, so no extra dependency like
 * react-signature-canvas is needed. Shared between /client's signature
 * step and the two public report pages, per the handoff's "reusing the
 * same signature component as /client". */
export const SignaturePad = forwardRef<
  SignaturePadHandle,
  { hintText?: string; onInkChange?: (hasInk: boolean) => void }
>(function SignaturePad({ hintText = 'Sign above the line', onInkChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#415364';

    let drawing = false;
    const pos = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
    };
    const onDown = (e: PointerEvent) => {
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
      setHasInk(true);
      onInkChange?.(true);
    };
    const onMove = (e: PointerEvent) => {
      if (!drawing) return;
      const [x, y] = pos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
    };
    const onUp = () => {
      drawing = false;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    isEmpty: () => !hasInk,
    clear: () => {
      const canvas = canvasRef.current;
      canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      setHasInk(false);
      onInkChange?.(false);
    },
    toDataURL: () => canvasRef.current!.toDataURL('image/png'),
  }));

  return (
    <div className={`sign-pad-wrap ${hasInk ? 'has-ink' : ''}`}>
      <canvas ref={canvasRef} width={1140} height={300} />
      {!hasInk && <div className="sign-pad-hint">{hintText}</div>}
    </div>
  );
});
