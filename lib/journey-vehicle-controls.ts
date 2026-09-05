export type JourneyVehicleCriteria = { manufacturer?: string; model?: string; yearFrom?: number; yearTo?: number; match?: 'all' | 'any' };
export type JourneyVehiclePreferenceOptions = { prefer?: boolean; avoid?: boolean; includeUnconfirmed?: boolean };
export type VerifiedFleetFact = { manufacturer?: string | null; model?: string | null; year?: string | number | null };
export type VehiclePolicy = 'off' | 'prefer' | 'avoid';
export type YearDraft = { from: string; to: string };
const text = (value?: string | null) => value?.trim() || undefined;
export function manufacturerChoices(facts: readonly VerifiedFleetFact[]) {
  return [...new Set(facts.map(fact => text(fact.manufacturer)).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b));
}
export function modelChoicesForManufacturer(facts: readonly VerifiedFleetFact[], manufacturer?: string) {
  if (!manufacturer) return [];
  return [...new Set(facts.map(fact => text(fact.manufacturer) === manufacturer ? text(fact.model) : undefined).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b));
}
export function vehiclePolicy(options: JourneyVehiclePreferenceOptions): VehiclePolicy {
  return options.avoid ? 'avoid' : options.prefer ? 'prefer' : 'off';
}
export function optionsForPolicy(mode: VehiclePolicy, options: JourneyVehiclePreferenceOptions): JourneyVehiclePreferenceOptions {
  return { ...options, prefer: mode === 'prefer', avoid: mode === 'avoid' };
}
export function chooseVehicleManufacturer(criteria: JourneyVehicleCriteria, manufacturer?: string): JourneyVehicleCriteria {
  return { ...criteria, manufacturer, model: manufacturer === criteria.manufacturer ? criteria.model : undefined };
}
export function yearDraftFor(criteria: JourneyVehicleCriteria): YearDraft {
  return { from: criteria.yearFrom === undefined ? '' : String(criteria.yearFrom), to: criteria.yearTo === undefined ? '' : String(criteria.yearTo) };
}
export function yearDraftError({ from, to }: YearDraft): 'invalid' | 'reversed' | null {
  for (const value of [from, to]) if (value !== '' && (!/^[0-9]{4}$/.test(value) || Number(value) < 1800 || Number(value) > 3000)) return 'invalid';
  return from && to && Number(from) > Number(to) ? 'reversed' : null;
}
export function criteriaFromDraft(criteria: JourneyVehicleCriteria, years: YearDraft): JourneyVehicleCriteria | null {
  if (yearDraftError(years)) return null;
  return { ...criteria, yearFrom: years.from === '' ? undefined : Number(years.from), yearTo: years.to === '' ? undefined : Number(years.to) };
}
