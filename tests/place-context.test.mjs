import test from 'node:test';
import assert from 'node:assert/strict';
import { withPlaceContext } from '../server/place-context.mjs';
const route={id:'ttc:2',routeId:'2',color:'008000'};
const stop={id:'ttc:1',name:'Warden westbound',lat:43.711,lon:-79.279,servingRoutes:[route]};
test('map station gains explicitly nearby routes without inventing exact service',()=>{
 const station={id:'node/1',name:'Warden',kind:'station',lat:43.7111,lon:-79.279};
 const [result]=withPlaceContext([station],[stop]);
 assert.equal(result.id,station.id);assert.equal(result.servingRoutes,undefined);
 assert.equal(result.nearbyTransit.routes[0].color,'008000');assert.equal(result.nearbyTransit.distanceMetres,11);
 assert.equal(station.nearbyTransit,undefined);
});
test('same name far away cannot inherit station routes and invalid coordinates never match',()=>{
 for(const lat of [43.77,NaN,undefined])assert.equal(withPlaceContext([{id:'other',name:'Warden',lat,lon:-79.279}],[stop])[0].nearbyTransit,undefined);
});
test('exact routes stay exact and duplicate nearby routes are collapsed',()=>{
 assert.equal(withPlaceContext([stop],[stop])[0],stop);
 const [result]=withPlaceContext([{id:'map',lat:43.711,lon:-79.279}],[stop,{...stop,id:'ttc:2'}]);
 assert.equal(result.nearbyTransit.routes.length,1);
});
