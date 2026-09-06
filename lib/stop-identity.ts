/** Normalize only known feed aliases. Never match unrelated agencies by numeric suffix. */
export function qualifiedStopId(id: string, agency: string): string {
  const normalizedAgency = agency === 'ttc-next' ? 'ttc' : agency;
  const separator=id.indexOf(':');
  if(separator<0)return `${normalizedAgency}:${id}`;
  const prefix=id.slice(0,separator);
  return `${prefix==='ttc-next'?'ttc':prefix}:${id.slice(separator+1)}`;
}
export function samePublishedStop(left: string | undefined, right: string, agency: string): boolean {
  return typeof left === 'string' && !!left && qualifiedStopId(left,agency)===qualifiedStopId(right,agency);
}
