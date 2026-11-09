(function(){const n=document.createElement("link").relList;if(n&&n.supports&&n.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))a(i);new MutationObserver(i=>{for(const c of i)if(c.type==="childList")for(const d of c.addedNodes)d.tagName==="LINK"&&d.rel==="modulepreload"&&a(d)}).observe(document,{childList:!0,subtree:!0});function t(i){const c={};return i.integrity&&(c.integrity=i.integrity),i.referrerPolicy&&(c.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?c.credentials="include":i.crossOrigin==="anonymous"?c.credentials="omit":c.credentials="same-origin",c}function a(i){if(i.ep)return;i.ep=!0;const c=t(i);fetch(i.href,c)}})();const se=`// CGMES IGMs that reference the public ENTSO-E boundary set.
// Ids that are referenced but not declared in your files (boundary
// ConnectivityNodes, TopologicalNodes, BaseVoltages) are kept, and boundary
// node names (X-nodes) are preserved, so the anonymized model still merges
// with the official boundary set.
{
  "name": "cgmes-boundary",
  "description": "Anonymize an IGM but keep everything that ties it to the ENTSO-E boundary set.",
  "preserveNames": [ "^X[A-Z0-9_-]{4,}$" ],
  "cim": {
    "anonymizeExternalReferences": false
  }
}
`,de=`// Internal test data: hide human-readable names but keep ids, mRIDs and bus
// numbers stable, so the model still lines up with SCADA point lists,
// historian tags and existing study scripts.
{
  "name": "names-only",
  "description": "Rename names and descriptions only; keep ids, mRIDs and bus numbers.",
  "cim": {
    "anonymizeIds": false,
    "anonymizeMrids": false,
    "stripComments": true
  },
  "psse": {
    "renumberBuses": false,
    "stripComments": true,
    "replaceCaseTitle": true
  }
}
`,le=`// Sharing a model with a vendor, consultant or research partner.
// Everything identifying goes: names, ids, descriptions, comments, titles,
// coordinates, and PSS/E bus numbers. Add your organisation's own names
// (and abbreviations) to redactTerms so they can't survive in free text.
{
  "name": "vendor-strict",
  "description": "Maximum removal for models leaving the organisation.",
  "redactTerms": [ "Your Utility Name", "YUN" ],
  "cim": {
    "stripComments": true,
    "replaceHeaders": true,
    "keepTypeHints": false
  },
  "psse": {
    "renumberBuses": true,
    "busNumberStrategy": "shuffled",
    "zeroCoordinates": true,
    "replaceCaseTitle": true,
    "stripComments": true
  }
}
`,ue=`<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/CIM100#" xmlns:md="http://iec.ch/TC57/61970-552/ModelDescription/1#" xmlns:eu="http://iec.ch/TC57/CIM100-European#">
  <md:FullModel rdf:about="urn:uuid:7d2b9a1e-4c3f-4e8a-9b1d-2f6e8a0c4d11">
    <md:Model.created>2026-11-01T10:00:00Z</md:Model.created>
    <md:Model.description>Meridian Power EQ export for Q4 planning</md:Model.description>
    <md:Model.modelingAuthoritySet>http://meridianpower.example/planning</md:Model.modelingAuthoritySet>
    <md:Model.DependentOn rdf:resource="urn:uuid:0a1b2c3d-1111-4222-8333-444455556666"/>
  </md:FullModel>
  <!-- exported by the Meridian EMS team -->
  <cim:Substation rdf:ID="_5f1c2b7a-1d2e-4f3a-8b9c-0d1e2f3a4b5c">
    <cim:IdentifiedObject.name>HARBOR POINT</cim:IdentifiedObject.name>
    <cim:IdentifiedObject.mRID>5f1c2b7a-1d2e-4f3a-8b9c-0d1e2f3a4b5c</cim:IdentifiedObject.mRID>
    <cim:IdentifiedObject.description>Harbor Point 230kV switching station</cim:IdentifiedObject.description>
  </cim:Substation>
  <cim:VoltageLevel rdf:ID="_6a2d3c8b-2e3f-4a4b-9c0d-1e2f3a4b5c6d">
    <cim:IdentifiedObject.name>230</cim:IdentifiedObject.name>
    <cim:VoltageLevel.Substation rdf:resource="#_5f1c2b7a-1d2e-4f3a-8b9c-0d1e2f3a4b5c"/>
  </cim:VoltageLevel>
  <cim:ACLineSegment rdf:ID="_7b3e4d9c-3f4a-4b5c-8d1e-2f3a4b5c6d7e">
    <cim:IdentifiedObject.name>HARBOR POINT-LAKESIDE 1</cim:IdentifiedObject.name>
    <cim:IdentifiedObject.mRID>7b3e4d9c-3f4a-4b5c-8d1e-2f3a4b5c6d7e</cim:IdentifiedObject.mRID>
    <cim:ACLineSegment.r>1.2</cim:ACLineSegment.r>
    <cim:ACLineSegment.x>12.5</cim:ACLineSegment.x>
    <cim:Equipment.EquipmentContainer rdf:resource="urn:uuid:0a1b2c3d-1111-4222-8333-444455556666"/>
  </cim:ACLineSegment>
  <cim:Substation rdf:ID="_8c4f5e0d-4a5b-4c6d-9e2f-3a4b5c6d7e8f">
    <cim:IdentifiedObject.name>LAKESIDE</cim:IdentifiedObject.name>
  </cim:Substation>
  <cim:Terminal rdf:ID="_9d5a6f1e-5b6c-4d7e-8f3a-4b5c6d7e8f9a">
    <cim:IdentifiedObject.name>LAKESIDE T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_7b3e4d9c-3f4a-4b5c-8d1e-2f3a4b5c6d7e"/>
    <cim:Terminal.phases rdf:resource="http://iec.ch/TC57/CIM100#PhaseCode.ABC"/>
  </cim:Terminal>
</rdf:RDF>
`,fe=`<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/2009/CIM-schema-cim14#">
<!-- Fictional sample network for demonstrating the anonymizer.
     Instances around NORTHWIND_SPARE busbar deleted. -->
<cim:GeographicalRegion rdf:ID="_1000"><cim:IdentifiedObject.name>MERIDIAN POOL</cim:IdentifiedObject.name></cim:GeographicalRegion>
<cim:SubGeographicalRegion rdf:ID="_1001"><cim:IdentifiedObject.name>CENTRAL</cim:IdentifiedObject.name><cim:SubGeographicalRegion.Region rdf:resource="#_1000"/></cim:SubGeographicalRegion>
<cim:BaseVoltage rdf:ID="_1010"><cim:IdentifiedObject.name>345</cim:IdentifiedObject.name><cim:BaseVoltage.nominalVoltage>345</cim:BaseVoltage.nominalVoltage></cim:BaseVoltage>
<cim:BaseVoltage rdf:ID="_1011"><cim:IdentifiedObject.name>138</cim:IdentifiedObject.name><cim:BaseVoltage.nominalVoltage>138</cim:BaseVoltage.nominalVoltage></cim:BaseVoltage>
<cim:Substation rdf:ID="_2000"><cim:IdentifiedObject.name>NORTHWIND</cim:IdentifiedObject.name><cim:IdentifiedObject.description>NORTHWIND</cim:IdentifiedObject.description><cim:Substation.Region rdf:resource="#_1001"/></cim:Substation>
<cim:VoltageLevel rdf:ID="_2001"><cim:IdentifiedObject.name>345</cim:IdentifiedObject.name><cim:VoltageLevel.Substation rdf:resource="#_2000"/><cim:VoltageLevel.BaseVoltage rdf:resource="#_1010"/></cim:VoltageLevel>
<cim:BusbarSection rdf:ID="_2002"><cim:IdentifiedObject.name>NW345_BB</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2001"/></cim:BusbarSection>
<cim:ConnectivityNode rdf:ID="_2003"><cim:IdentifiedObject.name>NW345_CN</cim:IdentifiedObject.name><cim:ConnectivityNode.ConnectivityNodeContainer rdf:resource="#_2001"/></cim:ConnectivityNode>
<cim:Terminal rdf:ID="_2004"><cim:IdentifiedObject.name>NW345_BB_TERM</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_2002"/><cim:Terminal.ConnectivityNode rdf:resource="#_2003"/><cim:ACDCTerminal.sequenceNumber>1</cim:ACDCTerminal.sequenceNumber></cim:Terminal>
<cim:Breaker rdf:ID="_2005"><cim:IdentifiedObject.name>NW34501</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2001"/><cim:Switch.normalOpen>false</cim:Switch.normalOpen><cim:Breaker.ratedCurrent>1000</cim:Breaker.ratedCurrent></cim:Breaker>
<cim:Terminal rdf:ID="_2006"><cim:IdentifiedObject.name>NW34501_TERM</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_2005"/><cim:Terminal.ConnectivityNode rdf:resource="#_2003"/><cim:ACDCTerminal.sequenceNumber>1</cim:ACDCTerminal.sequenceNumber></cim:Terminal>
<cim:Analog rdf:ID="_2007"><cim:IdentifiedObject.name>MW</cim:IdentifiedObject.name><cim:Measurement.measurementType>MW</cim:Measurement.measurementType><cim:Measurement.Terminal rdf:resource="#_2006"/></cim:Analog>
<cim:Analog rdf:ID="_2008"><cim:IdentifiedObject.name>MVAR</cim:IdentifiedObject.name><cim:Measurement.measurementType>MVAR</cim:Measurement.measurementType><cim:Measurement.Terminal rdf:resource="#_2006"/></cim:Analog>
<cim:CurrentLimit rdf:ID="_2009"><cim:IdentifiedObject.name>High1</cim:IdentifiedObject.name><cim:OperationalLimit.type>High1</cim:OperationalLimit.type><cim:CurrentLimit.value>1200</cim:CurrentLimit.value></cim:CurrentLimit>
<cim:CurrentLimit rdf:ID="_2010"><cim:IdentifiedObject.name>Low1</cim:IdentifiedObject.name><cim:OperationalLimit.type>Low1</cim:OperationalLimit.type><cim:CurrentLimit.value>1200</cim:CurrentLimit.value></cim:CurrentLimit>
<cim:VoltageLevel rdf:ID="_2011"><cim:IdentifiedObject.name>138</cim:IdentifiedObject.name><cim:VoltageLevel.Substation rdf:resource="#_2000"/><cim:VoltageLevel.BaseVoltage rdf:resource="#_1011"/></cim:VoltageLevel>
<cim:BusbarSection rdf:ID="_2012"><cim:IdentifiedObject.name>NW138_BB</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2011"/></cim:BusbarSection>
<cim:ConnectivityNode rdf:ID="_2013"><cim:IdentifiedObject.name>NW138_CN</cim:IdentifiedObject.name><cim:ConnectivityNode.ConnectivityNodeContainer rdf:resource="#_2011"/></cim:ConnectivityNode>
<cim:Terminal rdf:ID="_2014"><cim:IdentifiedObject.name>NW138_BB_TERM</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_2012"/><cim:Terminal.ConnectivityNode rdf:resource="#_2013"/><cim:ACDCTerminal.sequenceNumber>1</cim:ACDCTerminal.sequenceNumber></cim:Terminal>
<cim:Breaker rdf:ID="_2015"><cim:IdentifiedObject.name>NW13801</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2011"/><cim:Switch.normalOpen>false</cim:Switch.normalOpen><cim:Breaker.ratedCurrent>1000</cim:Breaker.ratedCurrent></cim:Breaker>
<cim:Terminal rdf:ID="_2016"><cim:IdentifiedObject.name>NW13801_TERM</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_2015"/><cim:Terminal.ConnectivityNode rdf:resource="#_2013"/><cim:ACDCTerminal.sequenceNumber>1</cim:ACDCTerminal.sequenceNumber></cim:Terminal>
<cim:Analog rdf:ID="_2017"><cim:IdentifiedObject.name>MW</cim:IdentifiedObject.name><cim:Measurement.measurementType>MW</cim:Measurement.measurementType><cim:Measurement.Terminal rdf:resource="#_2016"/></cim:Analog>
<cim:Analog rdf:ID="_2018"><cim:IdentifiedObject.name>MVAR</cim:IdentifiedObject.name><cim:Measurement.measurementType>MVAR</cim:Measurement.measurementType><cim:Measurement.Terminal rdf:resource="#_2016"/></cim:Analog>
<cim:CurrentLimit rdf:ID="_2019"><cim:IdentifiedObject.name>High1</cim:IdentifiedObject.name><cim:OperationalLimit.type>High1</cim:OperationalLimit.type><cim:CurrentLimit.value>1200</cim:CurrentLimit.value></cim:CurrentLimit>
<cim:CurrentLimit rdf:ID="_2020"><cim:IdentifiedObject.name>Low1</cim:IdentifiedObject.name><cim:OperationalLimit.type>Low1</cim:OperationalLimit.type><cim:CurrentLimit.value>1200</cim:CurrentLimit.value></cim:CurrentLimit>
<cim:EnergyConsumer rdf:ID="_2021"><cim:IdentifiedObject.name>NORTHWIND_FDR12</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2000"/><cim:EnergyConsumer.pfixed>42.5</cim:EnergyConsumer.pfixed><cim:EnergyConsumer.qfixed>13.1</cim:EnergyConsumer.qfixed></cim:EnergyConsumer>
<cim:Substation rdf:ID="_2022"><cim:IdentifiedObject.name>RIVERBEND</cim:IdentifiedObject.name><cim:IdentifiedObject.description>RIVERBEND</cim:IdentifiedObject.description><cim:Substation.Region rdf:resource="#_1001"/></cim:Substation>
<cim:VoltageLevel rdf:ID="_2023"><cim:IdentifiedObject.name>345</cim:IdentifiedObject.name><cim:VoltageLevel.Substation rdf:resource="#_2022"/><cim:VoltageLevel.BaseVoltage rdf:resource="#_1010"/></cim:VoltageLevel>
<cim:BusbarSection rdf:ID="_2024"><cim:IdentifiedObject.name>RB345_BB</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2023"/></cim:BusbarSection>
<cim:ConnectivityNode rdf:ID="_2025"><cim:IdentifiedObject.name>RB345_CN</cim:IdentifiedObject.name><cim:ConnectivityNode.ConnectivityNodeContainer rdf:resource="#_2023"/></cim:ConnectivityNode>
<cim:Terminal rdf:ID="_2026"><cim:IdentifiedObject.name>RB345_BB_TERM</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_2024"/><cim:Terminal.ConnectivityNode rdf:resource="#_2025"/><cim:ACDCTerminal.sequenceNumber>1</cim:ACDCTerminal.sequenceNumber></cim:Terminal>
<cim:Breaker rdf:ID="_2027"><cim:IdentifiedObject.name>RB34501</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2023"/><cim:Switch.normalOpen>false</cim:Switch.normalOpen><cim:Breaker.ratedCurrent>1000</cim:Breaker.ratedCurrent></cim:Breaker>
<cim:Terminal rdf:ID="_2028"><cim:IdentifiedObject.name>RB34501_TERM</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_2027"/><cim:Terminal.ConnectivityNode rdf:resource="#_2025"/><cim:ACDCTerminal.sequenceNumber>1</cim:ACDCTerminal.sequenceNumber></cim:Terminal>
<cim:Analog rdf:ID="_2029"><cim:IdentifiedObject.name>MW</cim:IdentifiedObject.name><cim:Measurement.measurementType>MW</cim:Measurement.measurementType><cim:Measurement.Terminal rdf:resource="#_2028"/></cim:Analog>
<cim:Analog rdf:ID="_2030"><cim:IdentifiedObject.name>MVAR</cim:IdentifiedObject.name><cim:Measurement.measurementType>MVAR</cim:Measurement.measurementType><cim:Measurement.Terminal rdf:resource="#_2028"/></cim:Analog>
<cim:CurrentLimit rdf:ID="_2031"><cim:IdentifiedObject.name>High1</cim:IdentifiedObject.name><cim:OperationalLimit.type>High1</cim:OperationalLimit.type><cim:CurrentLimit.value>1200</cim:CurrentLimit.value></cim:CurrentLimit>
<cim:CurrentLimit rdf:ID="_2032"><cim:IdentifiedObject.name>Low1</cim:IdentifiedObject.name><cim:OperationalLimit.type>Low1</cim:OperationalLimit.type><cim:CurrentLimit.value>1200</cim:CurrentLimit.value></cim:CurrentLimit>
<cim:VoltageLevel rdf:ID="_2033"><cim:IdentifiedObject.name>138</cim:IdentifiedObject.name><cim:VoltageLevel.Substation rdf:resource="#_2022"/><cim:VoltageLevel.BaseVoltage rdf:resource="#_1011"/></cim:VoltageLevel>
<cim:BusbarSection rdf:ID="_2034"><cim:IdentifiedObject.name>RB138_BB</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2033"/></cim:BusbarSection>
<cim:ConnectivityNode rdf:ID="_2035"><cim:IdentifiedObject.name>RB138_CN</cim:IdentifiedObject.name><cim:ConnectivityNode.ConnectivityNodeContainer rdf:resource="#_2033"/></cim:ConnectivityNode>
<cim:Terminal rdf:ID="_2036"><cim:IdentifiedObject.name>RB138_BB_TERM</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_2034"/><cim:Terminal.ConnectivityNode rdf:resource="#_2035"/><cim:ACDCTerminal.sequenceNumber>1</cim:ACDCTerminal.sequenceNumber></cim:Terminal>
<cim:Breaker rdf:ID="_2037"><cim:IdentifiedObject.name>RB13801</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2033"/><cim:Switch.normalOpen>false</cim:Switch.normalOpen><cim:Breaker.ratedCurrent>1000</cim:Breaker.ratedCurrent></cim:Breaker>
<cim:Terminal rdf:ID="_2038"><cim:IdentifiedObject.name>RB13801_TERM</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_2037"/><cim:Terminal.ConnectivityNode rdf:resource="#_2035"/><cim:ACDCTerminal.sequenceNumber>1</cim:ACDCTerminal.sequenceNumber></cim:Terminal>
<cim:Analog rdf:ID="_2039"><cim:IdentifiedObject.name>MW</cim:IdentifiedObject.name><cim:Measurement.measurementType>MW</cim:Measurement.measurementType><cim:Measurement.Terminal rdf:resource="#_2038"/></cim:Analog>
<cim:Analog rdf:ID="_2040"><cim:IdentifiedObject.name>MVAR</cim:IdentifiedObject.name><cim:Measurement.measurementType>MVAR</cim:Measurement.measurementType><cim:Measurement.Terminal rdf:resource="#_2038"/></cim:Analog>
<cim:CurrentLimit rdf:ID="_2041"><cim:IdentifiedObject.name>High1</cim:IdentifiedObject.name><cim:OperationalLimit.type>High1</cim:OperationalLimit.type><cim:CurrentLimit.value>1200</cim:CurrentLimit.value></cim:CurrentLimit>
<cim:CurrentLimit rdf:ID="_2042"><cim:IdentifiedObject.name>Low1</cim:IdentifiedObject.name><cim:OperationalLimit.type>Low1</cim:OperationalLimit.type><cim:CurrentLimit.value>1200</cim:CurrentLimit.value></cim:CurrentLimit>
<cim:EnergyConsumer rdf:ID="_2043"><cim:IdentifiedObject.name>RIVERBEND_FDR12</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2022"/><cim:EnergyConsumer.pfixed>42.5</cim:EnergyConsumer.pfixed><cim:EnergyConsumer.qfixed>13.1</cim:EnergyConsumer.qfixed></cim:EnergyConsumer>
<cim:Substation rdf:ID="_2044"><cim:IdentifiedObject.name>STONEGATE</cim:IdentifiedObject.name><cim:IdentifiedObject.description>STONEGATE</cim:IdentifiedObject.description><cim:Substation.Region rdf:resource="#_1001"/></cim:Substation>
<cim:VoltageLevel rdf:ID="_2045"><cim:IdentifiedObject.name>345</cim:IdentifiedObject.name><cim:VoltageLevel.Substation rdf:resource="#_2044"/><cim:VoltageLevel.BaseVoltage rdf:resource="#_1010"/></cim:VoltageLevel>
<cim:BusbarSection rdf:ID="_2046"><cim:IdentifiedObject.name>SG345_BB</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2045"/></cim:BusbarSection>
<cim:ConnectivityNode rdf:ID="_2047"><cim:IdentifiedObject.name>SG345_CN</cim:IdentifiedObject.name><cim:ConnectivityNode.ConnectivityNodeContainer rdf:resource="#_2045"/></cim:ConnectivityNode>
<cim:Terminal rdf:ID="_2048"><cim:IdentifiedObject.name>SG345_BB_TERM</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_2046"/><cim:Terminal.ConnectivityNode rdf:resource="#_2047"/><cim:ACDCTerminal.sequenceNumber>1</cim:ACDCTerminal.sequenceNumber></cim:Terminal>
<cim:Breaker rdf:ID="_2049"><cim:IdentifiedObject.name>SG34501</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2045"/><cim:Switch.normalOpen>false</cim:Switch.normalOpen><cim:Breaker.ratedCurrent>1000</cim:Breaker.ratedCurrent></cim:Breaker>
<cim:Terminal rdf:ID="_2050"><cim:IdentifiedObject.name>SG34501_TERM</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_2049"/><cim:Terminal.ConnectivityNode rdf:resource="#_2047"/><cim:ACDCTerminal.sequenceNumber>1</cim:ACDCTerminal.sequenceNumber></cim:Terminal>
<cim:Analog rdf:ID="_2051"><cim:IdentifiedObject.name>MW</cim:IdentifiedObject.name><cim:Measurement.measurementType>MW</cim:Measurement.measurementType><cim:Measurement.Terminal rdf:resource="#_2050"/></cim:Analog>
<cim:Analog rdf:ID="_2052"><cim:IdentifiedObject.name>MVAR</cim:IdentifiedObject.name><cim:Measurement.measurementType>MVAR</cim:Measurement.measurementType><cim:Measurement.Terminal rdf:resource="#_2050"/></cim:Analog>
<cim:CurrentLimit rdf:ID="_2053"><cim:IdentifiedObject.name>High1</cim:IdentifiedObject.name><cim:OperationalLimit.type>High1</cim:OperationalLimit.type><cim:CurrentLimit.value>1200</cim:CurrentLimit.value></cim:CurrentLimit>
<cim:CurrentLimit rdf:ID="_2054"><cim:IdentifiedObject.name>Low1</cim:IdentifiedObject.name><cim:OperationalLimit.type>Low1</cim:OperationalLimit.type><cim:CurrentLimit.value>1200</cim:CurrentLimit.value></cim:CurrentLimit>
<cim:VoltageLevel rdf:ID="_2055"><cim:IdentifiedObject.name>138</cim:IdentifiedObject.name><cim:VoltageLevel.Substation rdf:resource="#_2044"/><cim:VoltageLevel.BaseVoltage rdf:resource="#_1011"/></cim:VoltageLevel>
<cim:BusbarSection rdf:ID="_2056"><cim:IdentifiedObject.name>SG138_BB</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2055"/></cim:BusbarSection>
<cim:ConnectivityNode rdf:ID="_2057"><cim:IdentifiedObject.name>SG138_CN</cim:IdentifiedObject.name><cim:ConnectivityNode.ConnectivityNodeContainer rdf:resource="#_2055"/></cim:ConnectivityNode>
<cim:Terminal rdf:ID="_2058"><cim:IdentifiedObject.name>SG138_BB_TERM</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_2056"/><cim:Terminal.ConnectivityNode rdf:resource="#_2057"/><cim:ACDCTerminal.sequenceNumber>1</cim:ACDCTerminal.sequenceNumber></cim:Terminal>
<cim:Breaker rdf:ID="_2059"><cim:IdentifiedObject.name>SG13801</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2055"/><cim:Switch.normalOpen>false</cim:Switch.normalOpen><cim:Breaker.ratedCurrent>1000</cim:Breaker.ratedCurrent></cim:Breaker>
<cim:Terminal rdf:ID="_2060"><cim:IdentifiedObject.name>SG13801_TERM</cim:IdentifiedObject.name><cim:Terminal.ConductingEquipment rdf:resource="#_2059"/><cim:Terminal.ConnectivityNode rdf:resource="#_2057"/><cim:ACDCTerminal.sequenceNumber>1</cim:ACDCTerminal.sequenceNumber></cim:Terminal>
<cim:Analog rdf:ID="_2061"><cim:IdentifiedObject.name>MW</cim:IdentifiedObject.name><cim:Measurement.measurementType>MW</cim:Measurement.measurementType><cim:Measurement.Terminal rdf:resource="#_2060"/></cim:Analog>
<cim:Analog rdf:ID="_2062"><cim:IdentifiedObject.name>MVAR</cim:IdentifiedObject.name><cim:Measurement.measurementType>MVAR</cim:Measurement.measurementType><cim:Measurement.Terminal rdf:resource="#_2060"/></cim:Analog>
<cim:CurrentLimit rdf:ID="_2063"><cim:IdentifiedObject.name>High1</cim:IdentifiedObject.name><cim:OperationalLimit.type>High1</cim:OperationalLimit.type><cim:CurrentLimit.value>1200</cim:CurrentLimit.value></cim:CurrentLimit>
<cim:CurrentLimit rdf:ID="_2064"><cim:IdentifiedObject.name>Low1</cim:IdentifiedObject.name><cim:OperationalLimit.type>Low1</cim:OperationalLimit.type><cim:CurrentLimit.value>1200</cim:CurrentLimit.value></cim:CurrentLimit>
<cim:EnergyConsumer rdf:ID="_2065"><cim:IdentifiedObject.name>STONEGATE_FDR12</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_2044"/><cim:EnergyConsumer.pfixed>42.5</cim:EnergyConsumer.pfixed><cim:EnergyConsumer.qfixed>13.1</cim:EnergyConsumer.qfixed></cim:EnergyConsumer>
<cim:ACLineSegment rdf:ID="_2066"><cim:IdentifiedObject.name>NORTHWIND_RIVERBEND_L1</cim:IdentifiedObject.name><cim:ACLineSegment.r>0.85</cim:ACLineSegment.r><cim:ACLineSegment.x>16.4</cim:ACLineSegment.x><cim:ACLineSegment.bch>0.000663</cim:ACLineSegment.bch></cim:ACLineSegment>
<cim:ACLineSegment rdf:ID="_2067"><cim:IdentifiedObject.name>RIVERBEND_STONEGATE_L1</cim:IdentifiedObject.name><cim:ACLineSegment.r>0.85</cim:ACLineSegment.r><cim:ACLineSegment.x>16.4</cim:ACLineSegment.x><cim:ACLineSegment.bch>0.000663</cim:ACLineSegment.bch></cim:ACLineSegment>
</rdf:RDF>
`,pe=`0,   100.00, 33, 0, 1, 60.00     / PSS(R)E-33.3    RAW created by rawd33  SAT, NOV 07 2026  10:00
MERIDIAN POWER & LIGHT - 2026 SUMMER PEAK PLANNING CASE
NORTHWIND-RIVERBEND CORRIDOR STUDY, CONFIDENTIAL
   101,'NORTHWIND   ', 345.0000,3,   1,   1,   1,1.04000,   0.0000,1.10000,0.90000,1.10000,0.90000
   102,'NORTHWIND   ', 138.0000,1,   1,   1,   1,1.02100,  -2.1000,1.10000,0.90000,1.10000,0.90000
   201,'RIVERBEND   ', 345.0000,1,   1,   2,   1,1.03000,  -4.2000,1.10000,0.90000,1.10000,0.90000
   202,'RIVERBEND   ', 138.0000,1,   1,   2,   1,1.01500,  -6.0000,1.10000,0.90000,1.10000,0.90000
   301,'STONEGATE   ', 345.0000,1,   2,   3,   2,1.02000,  -5.5000,1.10000,0.90000,1.10000,0.90000
   302,'STONEGATE G1', 13.8000,2,   2,   3,   2,1.00000,  -3.0000,1.10000,0.90000,1.10000,0.90000
   303,'STONEGATE TV', 138.0000,1,   2,   3,   2,1.01000,  -6.5000,1.10000,0.90000,1.10000,0.90000
0 / END OF BUS DATA, BEGIN LOAD DATA
   102,'1 ',1,   1,   1,   120.000,    35.000,     0.000,     0.000,     0.000,     0.000,   1,1,0  / Meridian downtown feeders
   202,'1 ',1,   1,   2,    85.500,    22.100,     0.000,     0.000,     0.000,     0.000,   1,1,0
   303,'1 ',1,   2,   3,    60.000,    18.000,     0.000,     0.000,     0.000,     0.000,   2,1,0
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
   202,'1 ',1,     0.000,    25.000
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
   101,'1 ',   250.000,    40.000,   150.000,  -100.000,1.04000,     0,   300.000, 0.00000E+0, 2.50000E-1, 0.00000E+0, 0.00000E+0,1.00000,1,  100.0,   280.000,    20.000,   1,1.0000
   302,'1 ',   180.000,    30.000,   120.000,   -80.000,1.02000,   301,   200.000, 0.00000E+0, 2.20000E-1, 0.00000E+0, 0.00000E+0,1.00000,1,  100.0,   190.000,    10.000,   2,1.0000
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
   101,   201,'1 ', 2.50000E-3, 2.80000E-2,   0.45000,  1200.00,  1400.00,  1600.00,  0.00000,  0.00000,  0.00000,  0.00000,1,1,  85.00,   1,1.0000
   201,   301,'1 ', 2.00000E-3, 2.40000E-2,   0.38000,  1200.00,  1400.00,  1600.00,  0.00000,  0.00000,  0.00000,  0.00000,1,1,  70.00,   1,1.0000
   202,   303,'1 ', 6.00000E-3, 4.50000E-2,   0.02000,   300.00,   350.00,   400.00,  0.00000,  0.00000,  0.00000,  0.00000,1,1,  30.00,   2,1.0000
0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA
   101,   102,     0,'1 ',1,1,1,   0.00000,   0.00000,2,'NW XFMR T1  ',1,   1,1.0000,   0,1.0000,   0,1.0000,   0,1.0000,'YNd1        '
 2.00000E-3, 8.00000E-2,   100.00
1.00000,   0.000,   0.000,   400.00,   450.00,   500.00, 1,   102, 1.10000, 0.90000, 1.05000, 0.95000,  33, 0, 0.00000, 0.00000,  0.000
1.00000,   0.000
   301,   303,   302,'1 ',1,1,1,   0.00000,   0.00000,2,'SG AUTO 3W  ',1,   2,1.0000,   0,1.0000,   0,1.0000,   0,1.0000,'YNyn0d1     '
 1.50000E-3, 6.00000E-2,   100.00, 2.00000E-3, 9.00000E-2,   100.00, 1.80000E-3, 7.50000E-2,   100.00,1.00000,   0.0000
1.00000,   0.000,   0.000,   300.00,   330.00,   360.00, 1,  -303, 1.10000, 0.90000, 1.04000, 0.98000,  33, 0, 0.00000, 0.00000,  0.000
1.00000,   0.000,   0.000,   300.00,   330.00,   360.00, 0,     0, 1.10000, 0.90000, 1.10000, 0.90000,  33, 0, 0.00000, 0.00000,  0.000
1.00000,   0.000,   0.000,    50.00,    60.00,    70.00, 0,     0, 1.10000, 0.90000, 1.10000, 0.90000,  33, 0, 0.00000, 0.00000,  0.000
0 / END OF TRANSFORMER DATA, BEGIN AREA DATA
   1,   101,     0.000,    10.000,'MERIDIAN PL '
   2,   302,     0.000,    10.000,'STONEGATE CO'
0 / END OF AREA DATA, BEGIN TWO-TERMINAL DC DATA
0 / END OF TWO-TERMINAL DC DATA, BEGIN VSC DC LINE DATA
0 / END OF VSC DC LINE DATA, BEGIN IMPEDANCE CORRECTION DATA
0 / END OF IMPEDANCE CORRECTION DATA, BEGIN MULTI-TERMINAL DC DATA
0 / END OF MULTI-TERMINAL DC DATA, BEGIN MULTI-SECTION LINE DATA
0 / END OF MULTI-SECTION LINE DATA, BEGIN ZONE DATA
   1,'NORTHWIND Z '
   2,'RIVERBEND Z '
   3,'STONEGATE Z '
0 / END OF ZONE DATA, BEGIN INTER-AREA TRANSFER DATA
0 / END OF INTER-AREA TRANSFER DATA, BEGIN OWNER DATA
   1,'MERIDIAN P&L'
   2,'STONEGATE GN'
0 / END OF OWNER DATA, BEGIN FACTS DEVICE DATA
0 / END OF FACTS DEVICE DATA, BEGIN SWITCHED SHUNT DATA
   303,1,0,1,1.05000,0.95000,   301,100.0,'            ',    30.00,  2,  15.00
0 / END OF SWITCHED SHUNT DATA, BEGIN GNE DEVICE DATA
0 / END OF GNE DEVICE DATA, BEGIN INDUCTION MACHINE DATA
0 / END OF INDUCTION MACHINE DATA
Q
`,Ee=`@!IC,SBASE,REV,XFRRAT,NXFRAT,BASFRQ
0,   100.00, 35, 0, 1, 60.00     / PSS(R)E-35.4    RAW created by rawd35  SAT, NOV 07 2026  10:00
MERIDIAN POWER & LIGHT - 2026 WINTER PEAK
NODE-BREAKER MODEL FOR NORTHWIND SUBSTATION
GENERAL, THRSHZ=0.0001, PQBRAK=0.7, BLOWUP=5.0
RATING, 1, "RATE1 ", "RATING SET 1                    "
0 / END OF SYSTEM-WIDE DATA, BEGIN BUS DATA
@!   I,'NAME        ', BASKV, IDE,AREA,ZONE,OWNER, VM,        VA,    NVHI,   NVLO,   EVHI,   EVLO
   101,'NORTHWIND   ', 345.0000,3,   1,   1,   1,1.04000,   0.0000,1.10000,0.90000,1.10000,0.90000
   201,'RIVERBEND   ', 345.0000,1,   1,   2,   1,1.03000,  -4.2000,1.10000,0.90000,1.10000,0.90000
   202,'RIVERBEND   ', 138.0000,1,   1,   2,   1,1.01500,  -6.0000,1.10000,0.90000,1.10000,0.90000
0 / END OF BUS DATA, BEGIN LOAD DATA
   202,'1 ',1,   1,   2,    85.500,    22.100,     0.000,     0.000,     0.000,     0.000,   1,1,0,     0.000,     0.000,0,'            '
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
   101,'1 ',   250.000,    40.000,   150.000,  -100.000,1.04000,     0,     0,   300.000, 0.00000E+0, 2.50000E-1, 0.00000E+0, 0.00000E+0,1.00000,1,  100.0,   280.000,    20.000,     0.000,   1,1.0000
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
   101,   201,'1 ', 2.50000E-3, 2.80000E-2,   0.45000,'NW-RB 345 L1',  1200.00,  1400.00,  1600.00,     0.00,     0.00,     0.00,     0.00,     0.00,     0.00,     0.00,     0.00,     0.00,  0.00000,  0.00000,  0.00000,  0.00000,1,1,  85.00,   1,1.0000
0 / END OF BRANCH DATA, BEGIN SYSTEM SWITCHING DEVICE DATA
   201,   202,'1 ', 1.00000E-4,  2000.00,  2000.00,  2000.00,     0.00,     0.00,     0.00,     0.00,     0.00,     0.00,     0.00,     0.00,     0.00,1,1,1,2,'RB TIE BKR  '
0 / END OF SYSTEM SWITCHING DEVICE DATA, BEGIN TRANSFORMER DATA
0 / END OF TRANSFORMER DATA, BEGIN AREA DATA
   1,   101,     0.000,    10.000,'MERIDIAN PL '
0 / END OF AREA DATA, BEGIN TWO-TERMINAL DC DATA
0 / END OF TWO-TERMINAL DC DATA, BEGIN VSC DC LINE DATA
0 / END OF VSC DC LINE DATA, BEGIN IMPEDANCE CORRECTION DATA
0 / END OF IMPEDANCE CORRECTION DATA, BEGIN MULTI-TERMINAL DC DATA
0 / END OF MULTI-TERMINAL DC DATA, BEGIN MULTI-SECTION LINE DATA
0 / END OF MULTI-SECTION LINE DATA, BEGIN ZONE DATA
   1,'NORTHWIND Z '
   2,'RIVERBEND Z '
0 / END OF ZONE DATA, BEGIN INTER-AREA TRANSFER DATA
0 / END OF INTER-AREA TRANSFER DATA, BEGIN OWNER DATA
   1,'MERIDIAN P&L'
0 / END OF OWNER DATA, BEGIN FACTS DEVICE DATA
0 / END OF FACTS DEVICE DATA, BEGIN SWITCHED SHUNT DATA
   202,'1 ',1,0,1,1.05000,0.95000,   201,     0,100.0,'            ',    30.00,1,  2,  15.00
0 / END OF SWITCHED SHUNT DATA, BEGIN GNE DEVICE DATA
0 / END OF GNE DEVICE DATA, BEGIN INDUCTION MACHINE DATA
0 / END OF INDUCTION MACHINE DATA, BEGIN SUBSTATION DATA
   1,'NORTHWIND SS',  47.7423, -121.9857,  0.1000
   1,'NW 345 BUS A',   101,1, 1.04000,   0.0000
   2,'NW 345 BUS B',   101,1, 1.04000,   0.0000
0 / END OF SUBSTATION NODE DATA, BEGIN SUBSTATION SWITCHING DEVICE DATA
   1,   2,'1 ','NW 345 CB-12',2,1,1, 1.00000E-4,  2000.00,  2000.00,  2000.00
0 / END OF SUBSTATION SWITCHING DEVICE DATA, BEGIN SUBSTATION EQUIPMENT CONNECTION DATA
   101,   1,'M','1 '
0 / END OF SUBSTATION EQUIPMENT CONNECTION DATA
0 / END OF SUBSTATION DATA
Q
`,Ie=`contingency,monitored_element,from_bus_name,loading_pct
"NW-RB 345 L1 OUT",RIVERBEND TIE,RIVERBEND,104.2
"SG AUTO 3W OUT",NW XFMR T1,NORTHWIND,97.8
`;function ne(){return{name:"default",description:"Built-in defaults: rename identifying names and ids, keep electrical data intact.",preserveNames:[],redactTerms:[],redactionText:"REDACTED",cim:{anonymizeIds:!0,anonymizeExternalReferences:!0,preserveIdPatterns:[],anonymizeNames:!0,anonymizeMrids:!0,anonymizeDescriptions:!0,stripComments:!0,replaceHeaders:!0,keepTypeHints:!1,vocabularyMinCount:20,sensitiveClasses:["Substation","GeographicalRegion","SubGeographicalRegion","Line","ControlArea","Organisation","OperatingCompany","GeneratingUnit","ThermalGeneratingUnit","HydroGeneratingUnit","NuclearGeneratingUnit"],numericNameClasses:["VoltageLevel","BaseVoltage"],classPrefixes:{Substation:"SUB",VoltageLevel:"VL",Bay:"BAY",BusbarSection:"BUS",Breaker:"BKR",Disconnector:"DSC",GroundDisconnector:"GDS",LoadBreakSwitch:"LBS",Switch:"SW",Jumper:"JMP",Fuse:"FUS",ACLineSegment:"LN",Line:"LN",PowerTransformer:"TR",TransformerWinding:"TRW",PowerTransformerEnd:"TRE",RatioTapChanger:"RTC",PhaseTapChanger:"PTC",SynchronousMachine:"GEN",AsynchronousMachine:"AGEN",GeneratingUnit:"GU",ThermalGeneratingUnit:"GU",HydroGeneratingUnit:"GU",NuclearGeneratingUnit:"GU",WindGeneratingUnit:"GU",SolarGeneratingUnit:"GU",EnergyConsumer:"LOAD",ConformLoad:"LOAD",NonConformLoad:"LOAD",StationSupply:"AUX",EnergySource:"SRC",ExternalNetworkInjection:"INJ",EquivalentInjection:"EQI",EquivalentBranch:"EQB",ShuntCompensator:"SH",LinearShuntCompensator:"SH",NonlinearShuntCompensator:"SH",StaticVarCompensator:"SVC",SeriesCompensator:"SC",ConnectivityNode:"CN",TopologicalNode:"TN",Terminal:"T",GeographicalRegion:"REG",SubGeographicalRegion:"SREG",ControlArea:"CA",OperationalLimitSet:"OLS",CurrentLimit:"CL",VoltageLimit:"VL_LIM",ActivePowerLimit:"APL",ApparentPowerLimit:"SPL",Measurement:"MEAS",Analog:"ANA",Discrete:"DISC"},defaultPrefix:"OBJ",nameProperties:["IdentifiedObject.name"],descriptionProperties:["IdentifiedObject.description","IdentifiedObject.aliasName","IdentifiedObject.shortName"],headerProperties:{"md:Model.description":"Anonymized CIM model","md:Model.modelingAuthoritySet":"http://anonymized.invalid/{hash8}"},overwriteProperties:{"PositionPoint.xPosition":"0","PositionPoint.yPosition":"0","PositionPoint.zPosition":"0","StreetDetail.name":"","StreetDetail.number":"","StreetDetail.addressGeneral":"","TownDetail.name":"","TownDetail.code":"","StreetAddress.postalCode":""}},psse:{anonymizeNames:!0,replaceCaseTitle:!0,caseTitle:"ANONYMIZED CASE",stripComments:!0,renumberBuses:!1,busNumberStrategy:"shuffled",busNumberStart:1,zeroCoordinates:!0,keepStringPatterns:["^\\s*\\S{0,2}\\s*$","^\\s*[YyDdZz][Nn]?(\\s*[YyDdZz][Nn]?\\d{1,2})+\\s*$"],namePrefixes:{bus:"BUS",branch:"BR",transformer:"XF",area:"AREA",zone:"ZONE",owner:"OWNER","two-terminal-dc":"DC","vsc-dc":"VSC","multi-terminal-dc":"MTDC",facts:"FACTS","switched-shunt":"SWSH",gne:"GNE",substation:"SUB","substation-node":"NODE","substation-switching-device":"SWD","switching-device":"SWD","induction-machine":"IM",default:"NAME"}},text:{minNameLength:3}}}function Ne(e){let n="",t=0;const a=e.length;for(;t<a;){const i=e[t];if(i==='"'){let c=t+1;for(;c<a&&e[c]!=='"';)c+=e[c]==="\\"?2:1;n+=e.slice(t,c+1),t=c+1}else if(i==="/"&&e[t+1]==="/")for(;t<a&&e[t]!==`
`;)t++;else if(i==="/"&&e[t+1]==="*"){const c=e.indexOf("*/",t+2);t=c<0?a:c+2}else n+=i,t++}return JSON.parse(n.replace(/,(\s*[}\]])/g,"$1"))}function te(e){const n=Ne(e);if(!n||typeof n!="object")throw new Error("profile: not a JSON object");const t=ne();return{...t,...n,cim:{...t.cim,...n.cim??{}},psse:{...t.psse,...n.psse??{}},text:{...t.text,...n.text??{}}}}const be=e=>JSON.stringify(e,null,2),Te="2.0.0";async function Ae(){const e=new URLSearchParams(location.search).get("t")??"",n={"X-GridAnon-Token":e},t=async(l,f={})=>{const u=await fetch(l,{...f,headers:{...n,...f.headers??{}}});if(!u.ok)throw new Error(await u.text()||`${u.status} ${u.statusText}`);return u},a=await(await t("/api/info")).json();let i="";const c=new Map;async function d(l){i=(await(await t("/api/session",{method:"POST"})).json()).id,c.clear();for(const f of l){const u=await t(`/api/session/${i}/file?name=${encodeURIComponent(f.name)}`,{method:"PUT",body:f});c.set(f,(await u.json()).name)}}return{kind:"dotnet",outputDir:a.outputDir,version:a.version,async detect(l){return await d(l),await(await t(`/api/session/${i}/detect`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({names:l.map(u=>c.get(u))})})).json()},run(l,f,u,m){(async()=>{try{l.some(C=>!c.has(C))&&await d(l);const I=(await t(`/api/session/${i}/run`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...f,names:l.map(C=>c.get(C))})})).body.pipeThrough(new TextDecoderStream).getReader();let b="";for(;;){const{done:C,value:F}=await I.read();if(C)break;b+=F;let S;for(;(S=b.indexOf(`
`))>=0;){const D=b.slice(0,S).trim();if(b=b.slice(S+1),!D)continue;const A=JSON.parse(D);A.type==="file-done"&&A.file?.url&&(A.file.url+=`?t=${encodeURIComponent(e)}`),m(A)}}}catch(s){m({type:"error",message:s instanceof Error?s.message:String(s)})}})()}}}function Ce(){return Ae()}const L=await Ce(),V=L.kind==="dotnet",r=e=>document.getElementById(e),p=e=>r(e);function o(e,n={},...t){const a=Object.assign(document.createElement(e),n);return a.append(...t),a}const P=e=>e>=1e9?`${(e/1e9).toFixed(2)} GB`:e>=1e6?`${(e/1e6).toFixed(1)} MB`:`${Math.max(1,Math.round(e/1e3))} KB`,k=(e,n,t=n+"s")=>`${e.toLocaleString()} ${e===1?n:t}`,Oe=e=>e.replace(/^.*[\\/]/,""),g={get(e){try{return localStorage.getItem("gridanon."+e)}catch{return null}},set(e,n){try{localStorage.setItem("gridanon."+e,n)}catch{}}},U={default:be(ne()),"vendor-strict":le,"cgmes-boundary":se,"names-only":de},ge=[["sample-network.xml",fe],["cgmes_eq_uuid.xml",ue],["meridian_v33.raw",pe],["meridian_v35.raw",Ee],["study_results.csv",Ie]],ie={cim:"CIM / CGMES",psse:"PSS®E RAW",text:"Text",skip:"Skip"},H={names:["name","names"],ids:["id","ids"],refs:["reference","references"],mrids:["mRID","mRIDs"],descriptions:["description","descriptions"],busNumbers:["bus number","bus numbers"],titles:["title","titles"],comments:["comment","comments"],headers:["header","headers"],coordinates:["coordinate","coordinates"],overwritten:["overwritten value","overwritten values"],redactions:["redaction","redactions"],replacements:["replacement","replacements"],unmappedRefs:["unmapped reference","unmapped references"],externalIds:["external id","external ids"],unmappedBusRefs:["unmapped bus reference","unmapped bus references"],trailerLinesDropped:["trailing line dropped","trailing lines dropped"]};let y="anonymize",E=[],O=[],q,$=[],v=!1,_=!1;const J=!V&&typeof window.showDirectoryPicker=="function";function B(e){e!=="settings"&&(y=e);for(const t of["anonymize","restore","settings"])r(`tab-${t}`).setAttribute("aria-selected",String(t===e));r("view-work").hidden=e==="settings",r("view-settings").hidden=e!=="settings";const n=y==="restore";r("drop-title").textContent=E.length?"Add more files":n?"Drop anonymized files":"Drop model files",r("drop-hint").textContent=n?"Vendor results, contingency lists or the anonymized model":"CIM/CGMES, PSS®E RAW and companion CSVs",r("quick").hidden=n,N()}function z(e){_=!e;for(const n of["drop","files","actionbar"])e||(r(n).hidden=!0);r("drop").hidden=!e,r("sample-line").hidden=!e||E.length>0,r("files").hidden=!e||E.length===0,N()}for(const e of["anonymize","restore","settings"])r(`tab-${e}`).addEventListener("click",()=>B(e));const h=r("drop"),j=r("picker");async function Y(e){const n=e.filter(i=>!E.some(c=>c.name===i.name&&c.size===i.size));if(n.length===0)return;let t;try{t=await L.detect([...E,...n])}catch(i){Q(`Could not read the files: ${i.message}`);return}const a=new Map(E.map((i,c)=>[i,O[c]]));E=[...E,...n],O=E.map((i,c)=>a.get(i)??t[c]??"skip"),G(),K(),B(y)}function he(e){E.splice(e,1),O.splice(e,1),G(),K(),B(y)}function K(){const e=r("files");e.replaceChildren(),e.hidden=E.length===0,h.classList.toggle("compact",E.length>0),r("sample-line").hidden=E.length>0,E.forEach((n,t)=>{const a=o("select",{title:"Format"});a.setAttribute("aria-label",`Format of ${n.name}`);for(const d of["cim","psse","text","skip"])a.append(o("option",{value:d,textContent:ie[d]}));a.value=O[t];const i=o("li",{className:O[t]==="skip"?"skipped":""},o("span",{className:"name",textContent:n.name}),a,o("span",{className:"size",textContent:P(n.size)}));a.addEventListener("change",()=>{O[t]=a.value,i.className=a.value==="skip"?"skipped":"",N()});const c=o("button",{className:"remove",type:"button",textContent:"×",title:`Remove ${n.name}`});c.setAttribute("aria-label",`Remove ${n.name}`),c.addEventListener("click",()=>he(t)),i.append(c),e.append(i)})}h.addEventListener("click",()=>j.click());h.addEventListener("keydown",e=>{(e.key==="Enter"||e.key===" ")&&(e.preventDefault(),j.click())});j.addEventListener("change",()=>{Y([...j.files??[]]),j.value=""});for(const e of["dragenter","dragover"])h.addEventListener(e,n=>{n.preventDefault(),h.classList.add("over")});for(const e of["dragleave","drop"])h.addEventListener(e,n=>{n.preventDefault(),h.classList.remove("over")});h.addEventListener("drop",e=>{const n=e.dataTransfer;n?.files.length&&Y([...n.files])});document.querySelector("[data-sample]").addEventListener("click",()=>{Y(ge.map(([e,n])=>new File([n],e)))});r("mapping-in").addEventListener("change",N);const De=[["renumber","renumber-settings"],["mapping","mapping-settings"]];for(const[e,n]of De){for(const[a,i]of[[e,n],[n,e]])p(a).addEventListener("change",()=>{p(i).checked=p(a).checked,g.set(e,String(p(a).checked)),N()});const t=g.get(e);t!==null&&(p(e).checked=p(n).checked=t==="true")}for(const e of["titles","comments","typehints","tofolder"]){const n=g.get(e);n!==null&&(p(e).checked=n==="true"),p(e).addEventListener("change",()=>{g.set(e,String(p(e).checked)),N()})}for(const e of["salt","redact"])r(e).addEventListener("input",N);r("mapping-continue").addEventListener("change",N);const R=[r("profile"),r("profile-settings")],Z=r("profile-file");function M(e){for(const n of R)n.value=e;e!=="custom"&&g.set("profile",e),re(),N()}for(const e of R)e.addEventListener("change",()=>{if(e.value==="custom"&&!q){Z.click();return}M(e.value)});Z.addEventListener("change",async()=>{const e=Z.files?.[0];if(!e){M(g.get("profile")??"default");return}const n=await e.text();try{te(n),q={name:e.name,json:n};for(const t of R)t.options[4].textContent=`Custom: ${e.name}`;M("custom")}catch(t){Q(`${e.name} is not a valid profile: ${t.message}`),M(g.get("profile")??"default")}});const X=()=>R[0].value==="custom"&&q?q.json:U[R[0].value]??U.default;function re(){try{r("profile-desc").textContent=te(X()).description??""}catch{r("profile-desc").textContent=""}}r("profile-dl").addEventListener("click",()=>{o("a",{href:URL.createObjectURL(new Blob([X()],{type:"application/json"})),download:`${R[0].value}-profile.json`}).click()});const W=g.get("profile");W&&U[W]&&M(W);re();const ae=()=>r("redact").value.split(/\r?\n/).map(e=>e.trim()).filter(Boolean);function ye(){const e=[];r("salt").value.trim()&&e.push("your salt"),r("mapping-continue").files?.length&&e.push("previous mapping");const n=ae().length;return n&&e.push(k(n,"redact term")),p("titles").checked&&e.push("keep case titles"),p("comments").checked&&e.push("keep comments"),p("typehints").checked&&e.push("keep plant-type hints"),J&&p("tofolder").checked&&e.push("save to a folder"),e}function N(){const e=O.filter(l=>l!=="skip").length,n=y==="restore";r("actionbar").hidden=E.length===0||_;const t=r("run"),a=n?"Restore":"Anonymize";t.textContent=v?n?"Restoring…":"Anonymizing…":e>1?`${a} ${e} files`:a,t.disabled=v||e===0||n&&!r("mapping-in").files?.length,r("restore-mapping").hidden=!n||E.length===0||_;const i=n?[]:ye(),c=r("active-settings");c.hidden=i.length===0||E.length===0||_,c.replaceChildren(`Also applied: ${i.join(", ")}. `);const d=o("button",{type:"button",className:"link",textContent:"Change"});d.addEventListener("click",()=>B("settings")),c.append(d)}function G(){$.forEach(e=>URL.revokeObjectURL(e)),$=[],r("results").hidden=!0,r("results").replaceChildren(),_&&z(!0)}function Se(){E=[],O=[],G(),K(),B(y)}function Q(e){const n=r("results");n.hidden=!1,n.replaceChildren(o("p",{className:"notice",textContent:e}))}function ee(e,n){const t=`${Math.round(Math.min(1,e)*100)}%`;for(const a of document.querySelectorAll(".phase-bar i"))a.style.setProperty("--p",t);r("progress-label").textContent=n}function ce(e,n,t,a){const i=URL.createObjectURL(e);$.push(i);const c=o("a",{href:i,download:n,textContent:t,className:"secondary"});return a&&(c.id=a),c}function ve(e){const n=[ie[e.format]??e.format];for(const t of["names","busNumbers","ids","replacements"].filter(a=>e.stats[a]).slice(0,2))n.push(k(e.stats[t],H[t][0],H[t][1]));return n.join(", ")}function Le(e,n,t,a){const i=Oe(n.output??n.input),c=n.audit?.clean??!0,d=o("li",{className:"result"});d.dataset.clean=String(c);const l=o("div",{},o("p",{className:"result-name",textContent:i}),o("p",{className:"result-meta",textContent:ve(n)})),f=o("div",{className:"result-head"},o("span",{className:"dot"}),l);t?f.append(ce(t,i,"Download")):a?f.append(o("a",{href:a,download:i,textContent:"Download",className:"secondary"})):f.append(o("span",{className:"hint",textContent:"Saved"}));for(const s of f.querySelectorAll("a"))s.classList.add("download");d.append(f);const u=o("details",{},o("summary",{textContent:"Details"}));if(n.audit){const s=n.audit;if(s.clean)u.append(o("p",{className:"finding clean",textContent:`Audit passed: none of ${k(s.hunted,"identifying value")} found. ${k(s.vocabularyExcluded,"shared label")} kept on purpose.`}));else{const I=o("ul");s.leakedNames.length&&I.append(o("li",{textContent:`Names: ${s.leakedNames.join(", ")}`})),s.leakedIds.length&&I.append(o("li",{textContent:`Ids: ${s.leakedIds.join(", ")}`})),s.leakedTerms.length&&I.append(o("li",{textContent:`Redact terms: ${s.leakedTerms.join(", ")}`}));for(const b of s.integrityIssues)I.append(o("li",{textContent:b}));u.append(o("div",{className:"finding leak"},"Do not share this file. The audit found:",I)),u.open=!0}}for(const s of n.warnings)u.append(o("p",{className:"warning",textContent:s}));const m=o("p",{className:"stats"});for(const[s,I]of Object.entries(n.stats)){if(s==="revision"||!I)continue;const[b,C]=H[s]??[s,s];m.append(o("span",{},o("b",{textContent:I.toLocaleString()}),` ${I===1?b:C}`))}m.append(o("span",{},`${P(n.bytesIn)} in, ${P(n.bytesOut)} out${n.stats.revision?`, rev ${n.stats.revision}`:""}`)),u.append(m),V&&n.output&&u.append(o("p",{className:"hint",textContent:`Saved as ${n.output}`})),d.append(u),e.append(d)}r("run").addEventListener("click",async()=>{if(v)return;const e=y==="restore";let n;if(!e&&J&&p("tofolder").checked)try{n=await window.showDirectoryPicker({mode:"readwrite"})}catch{return}const t=e?r("mapping-in").files?.[0]:r("mapping-continue").files?.[0],a=r("salt").value.trim(),i=E.map((m,s)=>[m,O[s]]).filter(([,m])=>m!=="skip"),c={mode:e?"restore":"anonymize",formats:i.map(([,m])=>m),profileJson:X(),overrides:{renumberBuses:p("renumber").checked,keepComments:p("comments").checked,keepTitles:p("titles").checked,keepTypeHints:p("typehints").checked,redactTerms:e?[]:ae()},salt:!e&&a?a:void 0,mappingJson:t?await t.text():void 0};G(),v=!0,N(),r("progress").hidden=!1,ee(.02,"Starting");const d=r("results"),l=o("ul",{className:"result-list"}),f=[];let u=0;L.run(i.map(([m])=>m),c,n,m=>{if(m.type==="progress"){const s=m.stage==="scanning"?.15:m.stage==="auditing"?.8:.5;ee((m.index+s)/Math.max(1,m.total),`${m.stage[0].toUpperCase()}${m.stage.slice(1)} ${m.file}`)}else if(m.type==="file-done")f.push(m.report),(m.file?.blob||m.file?.url)&&u++,Le(l,m.report,m.file?.blob,m.file?.url);else if(m.type==="done"){v=!1,r("progress").hidden=!0;const s=f.filter(A=>A.audit&&!A.audit.clean).length,I=f.length,b=e?`Restored ${k(I,"file")}`:s?I===1?"The file failed the audit":`${s} of ${I} files failed the audit`:I===1?"The file is clean":`All ${I} files are clean`,C=V?`Saved to ${L.outputDir}.`:n?"Saved to the folder you chose.":e?"Names, ids and bus numbers are back to the originals.":s?"Open the red file to see what was found. Do not share it.":"Nothing identifying was found in the output.",F=o("button",{type:"button",className:"secondary",textContent:"Back to files",id:"back"});F.addEventListener("click",()=>{G()});const S=o("button",{type:"button",className:"secondary",textContent:"Start over",id:"start-over"});S.addEventListener("click",Se),d.replaceChildren(o("div",{className:"verdict-row"},o("div",{},o("div",{className:`verdict ${s?"leak":"clean"}`},o("h2",{textContent:b})),o("p",{className:"verdict-sub",textContent:C})),o("div",{className:"verdict-actions"},F,S)),l),z(!1);const D=o("div",{className:"result-foot"});if(u>1){const A=o("button",{type:"button",className:"secondary",textContent:`Download all ${u}`});A.addEventListener("click",()=>l.querySelectorAll("a.download").forEach((oe,me)=>setTimeout(()=>oe.click(),me*250))),D.append(A)}!e&&p("mapping").checked&&D.append(ce(new Blob([m.mapping],{type:"application/json"}),"gridanon_mapping.json","Download mapping","dl-mapping")),D.childElementCount&&d.append(D),!e&&m.saltWasGenerated&&d.append(o("p",{className:"salt-note"},"Random salt used: ",o("code",{textContent:m.salt}),". Save it, or the mapping, to anonymize related files the same way later.")),d.hidden=!1,N()}else m.type==="error"&&(v=!1,r("progress").hidden=!0,Q(m.message),z(!0),N())})});const Re={profile:{name:"profiles",body:["A profile is a set of rules.","Standard renames names, ids, descriptions and comments, removes coordinates, and keeps bus numbers. It suits most sharing.","Vendor strict also shuffles bus numbers. Use it for models leaving your organisation.","CGMES boundary keeps references to the ENTSO-E boundary set, so the model still merges with it.","Names only keeps ids and bus numbers, so the model still lines up with SCADA point lists and study scripts.","Custom loads your own JSON. Download one from Settings as a starting point."]},renumber:{name:"renumbering buses",body:["Gives every PSS®E bus a new number, and updates every place that refers to it: branches, transformers, generator regulation, areas, switched shunts and more.","Bus numbers can identify a system. Leave this off if scripts or contingency files you keep elsewhere refer to buses by number, unless you anonymize those files in the same run.","CIM files are not affected."]},mapping:{name:"saving the mapping",body:["Downloads a private file that pairs every original name, id and bus number with its replacement.","You need it to restore results that come back from a vendor, or to anonymize the next revision with the same pseudonyms.","Anyone holding it can undo the anonymization. Keep it with the original model and never send it with the anonymized one."]},"restore-mapping":{name:"the mapping file",body:["Choose the mapping that was saved when these files were anonymized.","A mapping from a different run will not translate them back."]},salt:{name:"the salt",body:["A secret word that decides which pseudonyms are generated. The same salt and the same files always give the same output, so related files anonymized on different days still match.","Leave it empty to use a random salt, which is shown after each run. Treat it like a password: with the salt and the original model, someone could rebuild the mapping."]},continue:{name:"continuing from a mapping",body:["Load the mapping from an earlier run. Equipment that already had a pseudonym keeps it, and new equipment gets a new one.","Use it for next quarter's case or an updated CGMES set, so results stay comparable. The run uses that mapping's salt."]},redact:{name:"redact terms",body:["Words that must not appear anywhere in the output, including inside comments and descriptions: for example your company's name and its abbreviations.","Matching ignores case. Each match is replaced with REDACTED, and the audit fails if one survives."]},titles:{name:"case titles",body:["The two title lines of a PSS®E case usually describe the study and who owns the system.","By default they are replaced with ANONYMIZED CASE. Turn this on only if the titles contain nothing identifying."]},comments:{name:"comments",body:['XML comments and PSS®E "/" comments are removed by default, because they often mention real assets or people.',"Section markers such as END OF BUS DATA are always kept. If you turn this on, the audit still checks the comments for original names."]},typehints:{name:"plant-type hints",body:["Keeps suffixes such as _CC, _GT, _HYDRO or _WIND on renamed generating units, which can help a study.","Off by default: plant type, size and region together can identify a specific plant."]},tofolder:{name:"saving to a folder",body:["Writes results straight into a folder you choose, instead of keeping them in memory for download.","Use it for models of several hundred MB or more. Available in Chrome and Edge."]},outfolder:{name:"the output folder",body:["Where gridanon ui writes results on this computer. Each run adds files named like case_anonymized.raw.","To use another folder, stop gridanon ui and start it again with gridanon ui -o followed by the folder."]}};let Be=0,T;function x(){T&&(T.tip.hidden=!0,T.button.setAttribute("aria-expanded","false"),T=void 0)}for(const e of document.querySelectorAll("[data-help]")){const n=Re[e.dataset.help];if(!n)continue;const t=`tip-${++Be}`,a=o("button",{type:"button",className:"help-btn",textContent:"?"});a.setAttribute("aria-label",`About ${n.name}`),a.setAttribute("aria-expanded","false"),a.setAttribute("aria-controls",t);const i=o("div",{className:"tip",id:t,hidden:!0});i.setAttribute("role","note");for(const d of n.body)i.append(o("p",{textContent:d}));if(e.closest(".quick")){const d=e.closest(".select-wrap")??e,l=o("span",{className:"quick-pair"});d.replaceWith(l),l.append(d,a),r("quick-help").append(i)}else e.append(a),(e.closest(".row")??e.closest(".field-inline")??e.parentElement).append(i);a.addEventListener("click",d=>{d.preventDefault(),d.stopPropagation();const l=T?.button===a;x(),!l&&(i.hidden=!1,a.setAttribute("aria-expanded","true"),T={button:a,tip:i})})}document.addEventListener("keydown",e=>{if(e.key==="Escape"&&T){const n=T.button;x(),n.focus()}});document.addEventListener("click",e=>{T&&!T.tip.contains(e.target)&&e.target!==T.button&&x()});for(const e of["anonymize","restore","settings"])r(`tab-${e}`).addEventListener("click",x);const w=r("help-dialog");r("help-open").addEventListener("click",()=>{x(),w.showModal()});r("help-close").addEventListener("click",()=>w.close());w.addEventListener("click",e=>{e.target===w&&w.close()});r("version").textContent=V?`.NET edition ${L.version??""}.`:`TypeScript edition ${Te}.`;r("folder-row").hidden=!J;V&&(document.title="GridAnonymizer (.NET)",r("tagline").textContent="Anonymize CIM and PSS®E models with the .NET engine on this computer.",r("about-local").textContent="This page is served by gridanon on 127.0.0.1 and can only talk to it. Files never leave this computer.",r("help-privacy").textContent="The .NET engine on this computer does the work. This page is served by gridanon on 127.0.0.1 and can only talk to it, so your files never leave this computer.",r("dotnet-out").hidden=!1,r("dotnet-out-path").textContent=L.outputDir??"");B("anonymize");
