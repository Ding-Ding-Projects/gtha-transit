export type Place = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind?: string;
  agency?: string;
};
export type Leg = {
  tripId?:string;
  agencyFeedId?:string;
  vehicle?:{id:string;label?:string;fleetNumber?:string;timestamp?:string|number;cptdb?:{manufacturer?:string;model?:string;year?:string|number;url?:string;match?:string};photo?:{url:string;sourceUrl:string;credit:string;license:string;exactVehicle:boolean}|null}|null;
  mode: string;
  from: Place;
  to: Place;
  startTime: number | string;
  endTime: number | string;
  duration: number;
  realtime?:boolean;
  scheduledStartTime?:string;
  scheduledEndTime?:string;
  route?: string;
  routeColor?: string;
  agency?: string;
  headsign?: string;
  geometry?: string | { points: string };
  distance?: number;
  intermediateStops?: Place[];
};
export type Itinerary = {
  realtime?:{applied:boolean;agencies?:string[]};
  washrooms?:{name:string;source:string;openingHours?:string|null;wheelchair?:string|null}[];
  washroomPreferenceApplied?:boolean;
  id: string;
  startTime: number | string;
  endTime: number | string;
  duration: number;
  walkDistance: number;
  transfers: number;
  legs: Leg[];
};
export type Alert = {
  id: string;
  title: string;
  description: string;
  url?: string;
  updatedAt?: string;
};
export type Line = {
  id: string;
  name: string;
  color: string;
  state: 'good' | 'disrupted' | 'unknown';
  alerts: Alert[];
};
export type TransitStatus = {
  state: 'live' | 'stale' | 'unavailable';
  fetchedAt?: string;
  sourceUrl?: string;
  lines: Line[];
  alerts: Alert[];
};
