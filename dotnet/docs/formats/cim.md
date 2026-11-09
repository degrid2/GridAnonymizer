# CIM / CGMES (RDF-XML)

Supports IEC 61970-552 RDF/XML from CIM14 to CIM100 (CGMES 2.4.15 and 3.0), with any namespace prefix.

**Rewritten:** `rdf:ID`, `rdf:about` (`#_id` and `urn:uuid:`), `rdf:resource="#…"` and `rdf:resource="urn:uuid:…"`, the name/mRID/description properties from the profile, `md:Model.description` and `md:Model.modelingAuthoritySet`, comments, and GL/Location coordinates and address fields.

**Kept:** `rdf:resource="http://…#Enum.literal"` (enumerations), every numeric and boolean value, element order and whitespace.

**Multi-file sets:** pass every profile of a model in one run (or as a directory). Ids that one file declares and another only references map the same way. The mapping is shared across the run.

**Boundary set:** with `anonymizeExternalReferences: false`, references to objects not declared in your files (boundary ConnectivityNodes and TopologicalNodes) are left as they are. Use `profiles/cgmes-boundary.json`.

**Not handled:** CIM XML that is not RDF (e.g. IEC 61968-100 message envelopes) and RDF serialized as Turtle or JSON-LD. Contributions welcome.
