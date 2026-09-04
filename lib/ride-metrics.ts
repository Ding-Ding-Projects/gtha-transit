import type {Itinerary} from './types';
export function rideMetrics(journey:Itinerary){
 const sum=(mode:boolean)=>journey.legs.filter(l=>(l.mode==='WALK')===mode).reduce((n,l)=>n+(Number.isFinite(l.duration)?Math.max(0,l.duration):0),0);
 const rideSeconds=sum(false),walkSeconds=sum(true);
 const totalMetres=journey.legs.every(l=>typeof l.distance==='number'&&Number.isFinite(l.distance)&&l.distance>=0)?journey.legs.reduce((n,l)=>n+l.distance!,0):null;
 return {rideSeconds,walkSeconds,waitSeconds:Math.max(0,journey.duration-rideSeconds-walkSeconds),totalMetres};
}
export function kilometres(value:number|undefined|null){return typeof value==='number'&&Number.isFinite(value)&&value>=0?`${(value/1000).toFixed(value<1000?2:1)} km`:'—';}
