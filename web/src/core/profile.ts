/**
 * Profiles - same JSON schema as the .NET edition (profiles/*.json are shared).
 * Fields omitted from a profile keep these defaults; a section object
 * (cim/psse/text) is merged field by field, every other value is replaced whole.
 */

export interface CimOptions {
  anonymizeIds: boolean;
  anonymizeExternalReferences: boolean;
  preserveIdPatterns: string[];
  anonymizeNames: boolean;
  anonymizeMrids: boolean;
  anonymizeDescriptions: boolean;
  stripComments: boolean;
  replaceHeaders: boolean;
  keepTypeHints: boolean;
  vocabularyMinCount: number;
  sensitiveClasses: string[];
  numericNameClasses: string[];
  classPrefixes: Record<string, string>;
  defaultPrefix: string;
  nameProperties: string[];
  descriptionProperties: string[];
  headerProperties: Record<string, string>;
  overwriteProperties: Record<string, string>;
}

export interface PsseOptions {
  anonymizeNames: boolean;
  replaceCaseTitle: boolean;
  caseTitle: string;
  stripComments: boolean;
  renumberBuses: boolean;
  busNumberStrategy: string;
  busNumberStart: number;
  zeroCoordinates: boolean;
  keepStringPatterns: string[];
  namePrefixes: Record<string, string>;
}

export interface TextOptions {
  minNameLength: number;
}

export interface Profile {
  name: string;
  description?: string | null;
  preserveNames: string[];
  redactTerms: string[];
  redactionText: string;
  cim: CimOptions;
  psse: PsseOptions;
  text: TextOptions;
}

export function defaultProfile(): Profile {
  return {
    name: 'default',
    description: 'Built-in defaults: rename identifying names and ids, keep electrical data intact.',
    preserveNames: [],
    redactTerms: [],
    redactionText: 'REDACTED',
    cim: {
      anonymizeIds: true,
      anonymizeExternalReferences: true,
      preserveIdPatterns: [],
      anonymizeNames: true,
      anonymizeMrids: true,
      anonymizeDescriptions: true,
      stripComments: true,
      replaceHeaders: true,
      keepTypeHints: false,
      vocabularyMinCount: 20,
      sensitiveClasses: [
        'Substation', 'GeographicalRegion', 'SubGeographicalRegion', 'Line', 'ControlArea',
        'Organisation', 'OperatingCompany',
        'GeneratingUnit', 'ThermalGeneratingUnit', 'HydroGeneratingUnit', 'NuclearGeneratingUnit',
      ],
      numericNameClasses: ['VoltageLevel', 'BaseVoltage'],
      classPrefixes: {
        Substation: 'SUB', VoltageLevel: 'VL', Bay: 'BAY', BusbarSection: 'BUS',
        Breaker: 'BKR', Disconnector: 'DSC', GroundDisconnector: 'GDS', LoadBreakSwitch: 'LBS',
        Switch: 'SW', Jumper: 'JMP', Fuse: 'FUS', ACLineSegment: 'LN', Line: 'LN',
        PowerTransformer: 'TR', TransformerWinding: 'TRW', PowerTransformerEnd: 'TRE',
        RatioTapChanger: 'RTC', PhaseTapChanger: 'PTC',
        SynchronousMachine: 'GEN', AsynchronousMachine: 'AGEN',
        GeneratingUnit: 'GU', ThermalGeneratingUnit: 'GU', HydroGeneratingUnit: 'GU',
        NuclearGeneratingUnit: 'GU', WindGeneratingUnit: 'GU', SolarGeneratingUnit: 'GU',
        EnergyConsumer: 'LOAD', ConformLoad: 'LOAD', NonConformLoad: 'LOAD',
        StationSupply: 'AUX', EnergySource: 'SRC', ExternalNetworkInjection: 'INJ',
        EquivalentInjection: 'EQI', EquivalentBranch: 'EQB',
        ShuntCompensator: 'SH', LinearShuntCompensator: 'SH', NonlinearShuntCompensator: 'SH',
        StaticVarCompensator: 'SVC', SeriesCompensator: 'SC',
        ConnectivityNode: 'CN', TopologicalNode: 'TN', Terminal: 'T',
        GeographicalRegion: 'REG', SubGeographicalRegion: 'SREG', ControlArea: 'CA',
        OperationalLimitSet: 'OLS', CurrentLimit: 'CL', VoltageLimit: 'VL_LIM',
        ActivePowerLimit: 'APL', ApparentPowerLimit: 'SPL',
        Measurement: 'MEAS', Analog: 'ANA', Discrete: 'DISC',
      },
      defaultPrefix: 'OBJ',
      nameProperties: ['IdentifiedObject.name'],
      descriptionProperties: ['IdentifiedObject.description', 'IdentifiedObject.aliasName', 'IdentifiedObject.shortName'],
      headerProperties: {
        'md:Model.description': 'Anonymized CIM model',
        'md:Model.modelingAuthoritySet': 'http://anonymized.invalid/{hash8}',
      },
      overwriteProperties: {
        'PositionPoint.xPosition': '0',
        'PositionPoint.yPosition': '0',
        'PositionPoint.zPosition': '0',
        'StreetDetail.name': '',
        'StreetDetail.number': '',
        'StreetDetail.addressGeneral': '',
        'TownDetail.name': '',
        'TownDetail.code': '',
        'StreetAddress.postalCode': '',
      },
    },
    psse: {
      anonymizeNames: true,
      replaceCaseTitle: true,
      caseTitle: 'ANONYMIZED CASE',
      stripComments: true,
      renumberBuses: false,
      busNumberStrategy: 'shuffled',
      busNumberStart: 1,
      zeroCoordinates: true,
      keepStringPatterns: ['^\\s*\\S{0,2}\\s*$', '^\\s*[YyDdZz][Nn]?(\\s*[YyDdZz][Nn]?\\d{1,2})+\\s*$'],
      namePrefixes: {
        bus: 'BUS', branch: 'BR', transformer: 'XF', area: 'AREA',
        zone: 'ZONE', owner: 'OWNER', 'two-terminal-dc': 'DC', 'vsc-dc': 'VSC',
        'multi-terminal-dc': 'MTDC', facts: 'FACTS', 'switched-shunt': 'SWSH',
        gne: 'GNE', substation: 'SUB', 'substation-node': 'NODE',
        'substation-switching-device': 'SWD', 'switching-device': 'SWD',
        'induction-machine': 'IM', default: 'NAME',
      },
    },
    text: { minNameLength: 3 },
  };
}

/** Parse JSON that may contain // and /* *\/ comments and trailing commas (as the shared profiles do). */
export function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

export function loadProfile(json: string): Profile {
  const raw = parseJsonc(json) as Partial<Profile> & { cim?: Partial<CimOptions>; psse?: Partial<PsseOptions>; text?: Partial<TextOptions> };
  if (!raw || typeof raw !== 'object') throw new Error('profile: not a JSON object');
  const d = defaultProfile();
  return {
    ...d,
    ...raw,
    cim: { ...d.cim, ...(raw.cim ?? {}) },
    psse: { ...d.psse, ...(raw.psse ?? {}) },
    text: { ...d.text, ...(raw.text ?? {}) },
  } as Profile;
}

export const profileToJson = (p: Profile): string => JSON.stringify(p, null, 2);
