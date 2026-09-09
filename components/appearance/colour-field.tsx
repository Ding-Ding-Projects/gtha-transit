'use client';

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { angleFromHue, clampHsv, fieldToHsv, hsvToField, hsvToRgb, hueFromAngle, stepHsv, type Hsv } from '../../lib/appearance/colour-field.ts';

export type Translate = (en: string, zh: string) => string;

export type ColourFieldProps = {
  value: Hsv;
  onChange: (next: Hsv) => void;
  label: string;
  t: Translate;
};

const SQUARE_SIZE = 200;
const RING_SIZE = 200;
const RING_THICKNESS = 20;
const RING_RADIUS = RING_SIZE / 2 - RING_THICKNESS / 2;

/** A pointer's position relative to an element's own box, in CSS pixels. */
function relativeToElement(event: { clientX: number; clientY: number }, element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * The saturation/value square, painted with two overlaid `<canvas>` gradients
 * (white-to-hue across, transparent-to-black down -- the standard technique,
 * and the reason this needs Canvas 2D rather than a CSS gradient: CSS has no
 * two-axis gradient primitive), plus a hue ring drawn as a plain `conic-
 * gradient` div, which is simpler and crisper than hand-rolling the same ring
 * in canvas pixels. `lib/appearance/colour-field.ts` owns every coordinate
 * conversion; this file only reads pointer and keyboard events and paints.
 */
export default function ColourField({ value, onChange, label, t }: ColourFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const squareRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const draggingSquare = useRef(false);
  const draggingRing = useRef(false);

  // Redrawn only when the hue changes -- moving the thumb inside an unchanged
  // gradient never needs the canvas itself repainted.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = SQUARE_SIZE * ratio;
    canvas.height = SQUARE_SIZE * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, SQUARE_SIZE, SQUARE_SIZE);

    const pure = hsvToRgb(value.h, 100, 100);
    const saturation = ctx.createLinearGradient(0, 0, SQUARE_SIZE, 0);
    saturation.addColorStop(0, '#ffffff');
    saturation.addColorStop(1, `rgb(${pure.r} ${pure.g} ${pure.b})`);
    ctx.fillStyle = saturation;
    ctx.fillRect(0, 0, SQUARE_SIZE, SQUARE_SIZE);

    const brightness = ctx.createLinearGradient(0, 0, 0, SQUARE_SIZE);
    brightness.addColorStop(0, 'rgba(0, 0, 0, 0)');
    brightness.addColorStop(1, 'rgba(0, 0, 0, 1)');
    ctx.fillStyle = brightness;
    ctx.fillRect(0, 0, SQUARE_SIZE, SQUARE_SIZE);
  }, [value.h]);

  const moveSquare = (event: { clientX: number; clientY: number }) => {
    const element = squareRef.current;
    if (!element) return;
    const { x, y } = relativeToElement(event, element);
    onChange(fieldToHsv(x, y, SQUARE_SIZE, SQUARE_SIZE, value.h));
  };

  const moveRing = (event: { clientX: number; clientY: number }) => {
    const element = ringRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    onChange(clampHsv({ ...value, h: hueFromAngle(event.clientX - centreX, event.clientY - centreY) }));
  };

  const onSquarePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingSquare.current = true;
    moveSquare(event);
  };
  const onSquarePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingSquare.current) return;
    moveSquare(event);
  };
  const endSquareDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingSquare.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onRingPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRing.current = true;
    moveRing(event);
  };
  const onRingPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRing.current) return;
    moveRing(event);
  };
  const endRingDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRing.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onSquareKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    onChange(stepHsv(value, event.key, event.shiftKey));
  };

  const onRingKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    onChange(clampHsv({ ...value, h: value.h + amount * direction }));
  };

  const thumb = hsvToField(value.h, value.s, value.v, SQUARE_SIZE, SQUARE_SIZE);
  const ringAngle = angleFromHue(value.h);
  const ringThumbX = RING_SIZE / 2 + RING_RADIUS * Math.cos(ringAngle);
  const ringThumbY = RING_SIZE / 2 + RING_RADIUS * Math.sin(ringAngle);

  return (
    <div className="appearance-colour-field">
      <div
        ref={squareRef}
        className="appearance-colour-field__square"
        style={{ width: SQUARE_SIZE, height: SQUARE_SIZE }}
        role="slider"
        tabIndex={0}
        aria-label={t(`${label}: saturation and brightness`, `${label}:飽和度同光度`)}
        aria-valuetext={t(`Saturation ${Math.round(value.s)}%, brightness ${Math.round(value.v)}%`, `飽和度 ${Math.round(value.s)}%,光度 ${Math.round(value.v)}%`)}
        onPointerDown={onSquarePointerDown}
        onPointerMove={onSquarePointerMove}
        onPointerUp={endSquareDrag}
        onPointerCancel={endSquareDrag}
        onKeyDown={onSquareKeyDown}
      >
        <canvas ref={canvasRef} width={SQUARE_SIZE} height={SQUARE_SIZE} style={{ width: SQUARE_SIZE, height: SQUARE_SIZE }} aria-hidden="true" />
        <span className="appearance-colour-field__thumb" style={{ left: thumb.x, top: thumb.y }} aria-hidden="true" />
      </div>

      <div
        ref={ringRef}
        className="appearance-colour-field__ring"
        style={{ width: RING_SIZE, height: RING_SIZE, ['--gtha-ring-thickness' as string]: `${RING_THICKNESS}px` }}
        role="slider"
        tabIndex={0}
        aria-label={t(`${label}: hue`, `${label}:色相`)}
        aria-valuetext={t(`Hue ${Math.round(value.h)} degrees`, `色相 ${Math.round(value.h)} 度`)}
        onPointerDown={onRingPointerDown}
        onPointerMove={onRingPointerMove}
        onPointerUp={endRingDrag}
        onPointerCancel={endRingDrag}
        onKeyDown={onRingKeyDown}
      >
        <span className="appearance-colour-field__ring-thumb" style={{ left: ringThumbX, top: ringThumbY }} aria-hidden="true" />
      </div>
    </div>
  );
}
