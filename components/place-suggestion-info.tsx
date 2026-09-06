import type { Place } from '../lib/types';
import { RouteBadges, WashroomBadge } from './stop-route-badges';
export default function PlaceSuggestionInfo({ place, t }: { place: Place; t: (en:string,zh:string)=>string }) {
  const names: Record<string,[string,string]>={station:['Station','車站'],stop:['Transit stop','交通站'],library:['Library','圖書館'],hospital:['Hospital','醫院'],school:['School','學校'],park:['Park','公園'],address:['Address','地址'],intersection:['Intersection','路口'],place:['Map location','地圖地點']};
  const kind=names[place.kind||'place']||[place.kind||'Location','地點'];
  const exact=place.servingRoutes||[];
  const nearby=exact.length?null:place.nearbyTransit;
  const location=[place.address,place.district,place.city].filter(v=>typeof v==='string'&&v.trim()).join(' · ');
  return <span className="place-suggestion-info">
    <small>{[place.agency,t(kind[0],kind[1])].filter(Boolean).join(' · ')}</small>
    {location&&<small>{location}</small>}
    {exact.length>0&&<><small className="suggestion-route-label">{t('Served by · timetable routes','途經路線 · 時間表資料')}</small><RouteBadges routes={exact} limit={6} t={t}/></>}
    {nearby&&<><small className="suggestion-route-label">{t(`Nearby transit · ${nearby.distanceMetres} m straight-line`,`附近交通 · 直線距離 ${nearby.distanceMetres} 米`)}</small><RouteBadges routes={nearby.routes} limit={6} t={t}/><small>{nearby.stopName}</small></>}
    {!exact.length&&!nearby&&['station','stop'].includes(place.kind||'')&&<small>{t('Route information unconfirmed for this location','此地點路線資料未確認')}</small>}
    <WashroomBadge washroom={place.washroom?{...place.washroom,availability:'unknown'}:null} t={t}/>
  </span>;
}
