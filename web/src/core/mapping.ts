/**
 * The private mapping file (gridanon-mapping/1). Identical schema to the .NET
 * edition, so a mapping written by either edition is read by the other.
 */

export const MAPPING_FORMAT = 'gridanon-mapping/1';

export interface CimMapping {
  ids: Record<string, string>;
  names: Record<string, string>;
  mrids: Record<string, string>;
  descriptions: Record<string, string>;
  preserved: string[];
}

export interface PsseMapping {
  names: Record<string, string>;
  buses: Record<string, number>;
}

export interface MappingDocument {
  format: string;
  warning: string;
  tool?: string;
  created: string;
  salt: string;
  profile?: string;
  sources: string[];
  cim: CimMapping;
  psse: PsseMapping;
}

export function emptyMapping(): MappingDocument {
  return {
    format: MAPPING_FORMAT,
    warning: 'PRIVATE - this file reverses the anonymization. Never publish it alongside the anonymized model.',
    created: new Date().toISOString(),
    salt: '',
    sources: [],
    cim: { ids: {}, names: {}, mrids: {}, descriptions: {}, preserved: [] },
    psse: { names: {}, buses: {} },
  };
}

export function parseMapping(json: string, source = 'mapping'): MappingDocument {
  const doc = JSON.parse(json) as Partial<MappingDocument>;
  if (doc.format !== MAPPING_FORMAT) throw new Error(`${source}: unsupported mapping format '${doc.format}' (expected ${MAPPING_FORMAT})`);
  const e = emptyMapping();
  return {
    ...e,
    ...doc,
    cim: { ...e.cim, ...(doc.cim ?? {}) },
    psse: { ...e.psse, ...(doc.psse ?? {}) },
  } as MappingDocument;
}

/** Same field order as the .NET serializer, 2-space indent. */
export function mappingToJson(m: MappingDocument): string {
  const ordered = {
    format: m.format, warning: m.warning, tool: m.tool, created: m.created, salt: m.salt,
    profile: m.profile, sources: m.sources, cim: m.cim, psse: m.psse,
  };
  return JSON.stringify(ordered, null, 2);
}

/** All original→pseudonym name/id pairs, for rewriting companion text files. */
export function* allTextPairs(m: MappingDocument): Generator<[string, string]> {
  for (const p of Object.entries(m.cim.names)) yield p;
  for (const p of Object.entries(m.cim.ids)) yield p;
  for (const p of Object.entries(m.cim.mrids)) yield p;
  for (const p of Object.entries(m.psse.names)) yield p;
}
