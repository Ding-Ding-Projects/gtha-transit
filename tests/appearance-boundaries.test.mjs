import test from 'node:test';
import assert from 'node:assert/strict';
import { SHIPPED_GLOBAL, UI_STATES } from '../lib/appearance/document.ts';
import { UI_ELEMENTS } from '../lib/appearance/elements.ts';
import { STYLE_PROPS } from '../lib/appearance/style-model.ts';
import { exportAppearance, importAppearance } from '../lib/appearance/transfer.ts';
import { compileAppearance, compileLayers } from '../lib/appearance/layers.ts';

test('appearance transfer rejects incomplete and malformed nested content without returning replacement data', () => {
  const good = JSON.parse(exportAppearance({ global: SHIPPED_GLOBAL, elements: [], layers: [], presets: [] }));
  assert.equal(importAppearance(JSON.stringify(good)).ok, true);
  for (const key of ['global','elements','layers','presets']) {
    const missing = { ...good }; delete missing[key];
    assert.equal(importAppearance(JSON.stringify(missing)).ok, false, key);
    assert.equal(importAppearance(JSON.stringify({ ...good, [key]: null })).ok, false, key);
  }
  assert.equal(importAppearance(JSON.stringify({ ...good, global: { ...good.global, density: 'unexpected' } })).ok, false);
  assert.equal(importAppearance(JSON.stringify({ ...good, elements: [{ id: 'body', states: { normal: { color: '#fff' } } }] })).ok, false);
  assert.equal(importAppearance(JSON.stringify({ ...good, layers: [{ id:'unsafe',kind:'fill',name:'Unsafe',value:'url(https://invalid.example)' }] })).ok, false);
});

const layer = (id, value) => ({ id, kind:'fill', name:id, visible:true, locked:false, opacity:1, value, elementId:'shell',state:'normal' });
test('fill order matches the visible top-to-bottom stack and retains more than four layers', () => {
  const layers = [layer('front','#ff0000'),layer('behind','#0000ff')];
  const css = compileLayers(layers);
  assert.ok(css.indexOf('#ff0000ff') < css.indexOf('#0000ffff'));
  const swapped = compileLayers([...layers].reverse());
  assert.ok(swapped.indexOf('#0000ffff') < swapped.indexOf('#ff0000ff'));
  const stack = compileLayers(Array.from({length:10},(_,i)=>layer(`layer-${i}`,'#ff0000')));
  assert.equal((stack.match(/linear-gradient/g)??[]).length,10);
});

test('compiled appearance refuses its total stylesheet bound', () => {
  const style = Object.fromEntries(STYLE_PROPS.map(prop=>[prop,prop.endsWith('color')?'#123456':'a'.repeat(190)]));
  const overrides=UI_ELEMENTS.map(element=>({id:element.id,states:Object.fromEntries(UI_STATES.map(state=>[state,style]))}));
  assert.throws(()=>compileAppearance({overrides,layers:[]}),RangeError);
  assert.equal(compileAppearance({overrides:[],layers:[]}), '');
});
