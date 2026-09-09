export type JourneyVehicleCriteria = { manufacturer?: string; model?: string; yearFrom?: number; yearTo?: number; match?: 'all' | 'any' };
export type JourneyVehiclePreferenceOptions = { prefer?: boolean; avoid?: boolean; includeUnconfirmed?: boolean };
export type VerifiedFleetFact = { manufacturer?: string | null; model?: string | null; year?: string | number | null };
export type VehiclePolicy = 'off' | 'prefer' | 'avoid';
export type YearDraft = { from: string; to: string };
/** The electric journey preference: Off, Prefer, or Avoid a verified electric assigned vehicle, plus whether an unconfirmed assignment is kept. */
export type ElectricPreference = { mode: VehiclePolicy; includeUnconfirmed: boolean };
/** Unconfirmed assignments are kept by default: this preference should narrow results only once someone has actually chosen Avoid. */
export const DEFAULT_ELECTRIC_PREFERENCE: ElectricPreference = { mode: 'off', includeUnconfirmed: true };
/** Validates a persisted or otherwise untrusted value, defaulting anything unrecognised rather than throwing. */
export function parseElectricPreference(value: unknown): ElectricPreference {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const mode: VehiclePolicy = record.mode === 'prefer' || record.mode === 'avoid' ? record.mode : 'off';
  const includeUnconfirmed = typeof record.includeUnconfirmed === 'boolean' ? record.includeUnconfirmed : DEFAULT_ELECTRIC_PREFERENCE.includeUnconfirmed;
  return { mode, includeUnconfirmed };
}
/** Converts the compact electric preference shape into the evaluator's prefer/avoid options. */
export function electricOptions(preference: ElectricPreference): JourneyVehiclePreferenceOptions {
  return { prefer: preference.mode === 'prefer', avoid: preference.mode === 'avoid', includeUnconfirmed: preference.includeUnconfirmed };
}
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
