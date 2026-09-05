'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, ArrowDown, GripVertical, Plus, X } from 'lucide-react';
import type { Place } from '../lib/types';

export type Destination = { id: string; place: Place | null };
export default function DestinationList({ items, onChange, renderField, t }: {
  items: Destination[];
  onChange: (items: Destination[]) => void;
  renderField: (item: Destination, index: number) => ReactNode;
  t: (en: string, zh: string) => string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const drag = useRef<{ id: string; original: Destination[] } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);
  const latest = useRef(items);
  latest.current = items;
  const [announcement, setAnnouncement] = useState('');
  const stopDrag = () => { drag.current = null; pointer.current = null; if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
  useEffect(() => () => stopDrag(), []);
  const move = (id: string, target: number) => {
    const current = latest.current;
    const index = current.findIndex(item => item.id === id);
    if (index < 0 || target < 0 || target >= current.length || index === target) return;
    const result = current.slice();
    result.splice(target, 0, result.splice(index, 1)[0]);
    latest.current = result;
    onChange(result);
    setAnnouncement(t(`Destination moved to position ${target + 1}.`, `目的地已移至第 ${target + 1} 位。`));
  };
  const scrollWhileDragging = () => {
    if (!drag.current || !pointer.current) return;
    const { x, y } = pointer.current;
    const delta = y < 80 ? -12 : y > window.innerHeight - 80 ? 12 : 0;
    if (delta) {
      window.scrollBy({ top: delta, behavior: 'instant' });
      const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-destination-id]');
      if (hit && root.current?.contains(hit)) move(drag.current.id, latest.current.findIndex(row => row.id === hit.dataset.destinationId));
    }
    frame.current = requestAnimationFrame(scrollWhileDragging);
  };
  return <div className="destination-list" ref={root}>
    {items.map((item, index) => <div key={item.id} className="destination-row" data-destination-id={item.id}>
      <div className="destination-row-tools">
        <button type="button" className="destination-drag icon-button" aria-label={t(`Drag destination ${index + 1} to reorder`, `拖動第 ${index + 1} 個目的地重新排序`)}
          onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0) return;
            drag.current = { id: item.id, original: latest.current.slice() };
            pointer.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
            frame.current = requestAnimationFrame(scrollWhileDragging);
          }}
          onPointerMove={event => {
            if (!drag.current) return;
            pointer.current = { x: event.clientX, y: event.clientY };
            const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-destination-id]');
            if (!hit || !root.current?.contains(hit)) return;
            move(drag.current.id, latest.current.findIndex(row => row.id === hit.dataset.destinationId));
          }}
          onPointerUp={stopDrag}
          onPointerCancel={() => { if (drag.current) onChange(drag.current.original); stopDrag(); }}
          onLostPointerCapture={stopDrag}
        ><GripVertical size={18} aria-hidden="true" /></button>
        <span className="destination-number">{index + 1}</span>
        <span className="destination-row-caption">{index === items.length - 1 ? t('Destination', '終點') : t('Via stop', '中途地點')}</span>
        <button type="button" className="icon-button" disabled={index === 0} aria-label={t(`Move destination ${index + 1} up`, `將第 ${index + 1} 個目的地上移`)} onClick={() => move(item.id, index - 1)}><ArrowUp size={16} aria-hidden="true" /></button>
        <button type="button" className="icon-button" disabled={index === items.length - 1} aria-label={t(`Move destination ${index + 1} down`, `將第 ${index + 1} 個目的地下移`)} onClick={() => move(item.id, index + 1)}><ArrowDown size={16} aria-hidden="true" /></button>
        <button type="button" className="icon-button" disabled={items.length === 1} aria-label={t(`Remove destination ${index + 1}`, `移除第 ${index + 1} 個目的地`)} onClick={() => onChange(items.filter(row => row.id !== item.id))}><X size={16} aria-hidden="true" /></button>
      </div>
      {renderField(item, index)}
    </div>)}
    <button type="button" className="add-destination pill" disabled={items.length >= 6} onClick={() => {
      let id: string;
      do { id = `destination-added-${nextId.current++}`; } while (items.some(item => item.id === id));
      onChange([...items.slice(0, -1), { id, place: null }, items[items.length - 1]]);
    }}><Plus size={17} aria-hidden="true" />{t('Add intermediate stop', '加入中途地點')}</button>
    <small className="data-note">{t('Up to five intermediate stops. Drag the handle or use the arrows to change their order.', '最多五個中途地點。拖動把手或使用箭嘴更改次序。')}</small>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </div>;
}
