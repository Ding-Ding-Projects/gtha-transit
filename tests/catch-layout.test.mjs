import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function isolatedFromFactGrid(text) {
  const source=ts.createSourceFile('tracker.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let found=0, valid=true;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source)==='CatchVehicle') {
      found++;
      for(let parent=node.parent;parent;parent=parent.parent) if(ts.isJsxElement(parent)) {
        const attribute=parent.openingElement.attributes.properties.find(item=>ts.isJsxAttribute(item)&&item.name.getText(source)==='className');
        if(attribute?.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text.split(/\s+/).includes('vehicle-facts')) valid=false;
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(source);return found===1&&valid;
}
test('the interception panel occupies the vehicle detail area rather than one fact-grid cell',()=>{
  assert.equal(isolatedFromFactGrid(readFileSync(new URL('../components/vehicle-tracker.tsx',import.meta.url),'utf8')),true);
  assert.equal(isolatedFromFactGrid('const view=<div className="vehicle-facts"><CatchVehicle /></div>;'),false);
  assert.equal(isolatedFromFactGrid('const view=<section><div className="vehicle-facts"/><CatchVehicle /></section>;'),true);
});
