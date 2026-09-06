const distance = (a,b) => {
  if (![a.lat,a.lon,b.lat,b.lon].every(v=>typeof v==='number'&&Number.isFinite(v))) return Infinity;
  const rad=Math.PI/180, dlat=(b.lat-a.lat)*rad, dlon=(b.lon-a.lon)*rad;
  return 6371000*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2)));
};
/** Nearby results are context only, never exact service or a substituted destination. */
export function withPlaceContext(places, stops) {
  return places.map(place=>{
    if(place.servingRoutes?.length) return place;
    const candidates=stops.filter(stop=>stop.id!==place.id&&stop.servingRoutes?.length)
      .map(stop=>({stop,metres:distance(place,stop)})).filter(x=>x.metres<=250).sort((a,b)=>a.metres-b.metres);
    if(!candidates.length)return place;
    const routes=new Map();
    for(const {stop} of candidates)for(const route of stop.servingRoutes)if(route.id)routes.set(route.id,route);
    return {...place,nearbyTransit:{distanceMetres:Math.round(candidates[0].metres),stopName:candidates[0].stop.name,routes:[...routes.values()].slice(0,12),scope:'Nearby stops in these search results; not a complete nearby-service inventory'}};
  });
}
