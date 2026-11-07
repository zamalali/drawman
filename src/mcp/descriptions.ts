// Model-facing tool descriptions. They are part of the product: wording here steers what agents draw.
import { config, conventions } from "../config.js"
import { FLOW_SHAPES, GENERAL_ICONS } from "../engine/index.js"
import { vocabulary } from "../repo/analyze.js"

const org = () => (conventions() ? `\nOrganisation conventions${config.profile.name ? ` (${config.profile.name})` : ""}:\n${conventions()}\n` : "")

export const TOOL_DESCRIPTION = () => `Draw a cloud architecture diagram (draw.io) that the user watches being built live.
Works for Google Cloud, Microsoft Azure, SAP BTP, on-premises SAP (S/4HANA, ECC, BW, GRC) and hybrid landscapes:
each component is drawn inside the frame of its platform, with official GCP, Azure and SAP BTP icons.
You only describe WHAT exists and HOW it talks; frames, zones, icons, orthogonal edge routing and the interface
legend are computed deterministically, so never think about positions or coordinates. Large landscapes are fine.

Write the arguments in this order: title, subtitle, then ALL nodes, then ALL interfaces.
Order nodes along the flow (users/sources first, then ingress, compute, data, consumers) so the diagram grows naturally.

Rules:
- Draw every component and connection the user names (up to 200 nodes); never merge or drop what they asked for.
- node.id: short_snake_case, unique. node.title: the component's name in the user's own wording. node.detail: max 7
  words (concrete: name, tier, region).
- node.kind MUST be one of the vocabulary below; it decides the platform frame, the zone and the official icon.
- containers: leave out unless the user explicitly names containers that hold components ("inside one VPC",
  "subnets", "cluster with namespaces", "two regions"). Then list exactly those as {id, title, parent?} (parent nests one
  inside another), set node.group, and leave components the user puts outside without a group. Never invent containers:
  without them the platform frames and zones are drawn automatically.
- status: "active" (default), "planned" or "bypassed" (drawn dashed), "external".
- interface: from/to are node ids, label (shown on the edge, max 4 words: what flows, e.g. "orders", "SQL reads"), protocol (HTTPS, OData, RFC, gRPC, Pub/Sub, JDBC, OIDC...), description one sentence.
- subtitle: e.g. "<gcp project> · <region>", "<BTP subaccount>" or the scenario.
- Release path: source repo -> CI -> docker_build -> (jfrog_artifactory when used) -> registry -> runtime.
  SAP BTP apps reach on-premises via sap_destination -> sap_connectivity -> sap_cloud_connector.
- To diagram an EXISTING codebase or repository, call analyze_repository instead of guessing. If analyze_repository
  handed you the evidence, pass repository=<its name> so the evidence-based release path is applied.
${org()}
Vocabulary (platform / zone: kinds):
${vocabulary()}

To change an existing diagram, call this tool again with the COMPLETE updated node and interface lists.
For flowcharts, business processes, approval and decision flows use create_flowchart; for API call flows
create_sequence_diagram; for lifecycles create_state_diagram; for object models create_class_diagram; for database
schemas create_er_diagram; for other diagrams that are NOT cloud or software infrastructure (ML model architectures
such as a Transformer, org charts, concept maps) use create_diagram.`

export const FLOWCHART_DESCRIPTION = () => `Draw a flowchart as a live, editable draw.io diagram with real flowchart shapes: rounded start/end, process
boxes, decision diamonds with Yes/No branches, data (input/output) parallelograms, documents, databases and sub-processes,
optionally in swimlanes. Use it for processes, workflows, procedures, approval flows, decision trees, algorithms, user
journeys and incident or support runbooks. The layout (rows along the flow, straight main line, branches beside it,
merges below), shape sizes and orthogonal routing are computed deterministically: never think about coordinates.

Write the arguments in this order: title, subtitle, direction, lanes, then ALL nodes, then ALL connections.
- nodes: {id, type, title, detail?, lane?, tone?} in flow order. type is one of ${FLOW_SHAPES.join(", ")}.
  Begin with one start and finish with end node(s). Decisions are short questions ending with "?".
  Step titles are short verb phrases (max 6 words). Steps that reject, fail or cancel are coloured red automatically.
- connections: {from, to, label?}. Every decision has 2-4 outgoing connections with labels ("Yes"/"No" or the options).
  Loops back to an earlier step (retry, rework) are fine.
- direction: "TB" top-down (default), "LR" left-to-right (short linear processes), "RL" right-to-left or "BT"
  bottom-to-top. lanes only when roles or departments matter.
- Up to 200 nodes. To change a flowchart, call the tool again with the COMPLETE updated nodes and connections.`

const NOT_FOR = `These tools draw boxes and the lines between them. They cannot draw spatial or pixel-accurate pictures:
floor plans, maps, seating plans, UI mockups / wireframes, charts or graphs of data, illustrations. For those, say so
plainly and suggest a fitting tool instead of forcing them into a diagram.`

export const SEQUENCE_DESCRIPTION = () => `Draw a UML sequence diagram as a live, editable draw.io diagram (native UML lifelines, activation
bars, fragments). Use it for API calls between services, request / auth / payment flows (OAuth, OIDC, SAML, checkout),
message exchanges, "what happens when ..." questions and call chains in code. Layout, spacing, activation bars and
fragment boxes are computed deterministically.

Write title, then ALL participants, then ALL messages, in time order.
- participants: {id, title, type?} left to right in the order they first act. type: ${["actor", "service", "database", "queue", "external"].join(", ")}
  (also boundary, control, entity). Max 10.
- messages: {from, to, label, type?} with type sync (default, a call), async (fire and forget), return (the answer,
  dashed) or create. A participant may message itself (internal step). Give every sync call its return when the
  answer matters. Labels are short: "POST /token (code)", "200 OK", "validate JWT".
- Inside messages you can also put control items, in order: {fragment: "alt" | "opt" | "loop" | "par" | "critical" | "break",
  label: "condition"} opens a box, {else: "condition"} starts its next branch, {end: true} closes it, and
  {note: "text", over: "participant id" or [ids]} adds a note. Fragments may nest.
- 2-10 participants, 2-60 messages. To change it, call again with the COMPLETE lists.`

export const STATE_DESCRIPTION = () => `Draw a UML state machine (state diagram) as a live, editable draw.io diagram: lifecycles and statuses of
orders, tickets, payments, documents, connections, workflows, protocol or UI states. Layout and routing are computed.

Write title, direction, then ALL states, then ALL transitions.
- states: {id, title, type?, detail?}. type is initial (the start dot, no title), final (end bullseye), state (default) or
  choice (a decision diamond). detail holds entry / do / exit activities, e.g. "entry / send email".
- transitions: {from, to, event?, guard?, action?} drawn as "event [guard] / action". A state may transition to itself.
- direction: "TB" (default), "LR", "RL" (right-to-left) or "BT" (bottom-to-top). 3-30 states. To change it, call again with the COMPLETE lists.`

export const CLASS_DESCRIPTION = () => `Draw a UML class diagram as a live, editable draw.io diagram (native class boxes with attribute and
method compartments). Use it for domain models, object-oriented designs, design patterns and the types in a codebase.

Write title, direction, then ALL classes, then ALL relationships.
- classes: {id, name, type?, attributes?, methods?}. type: class (default), interface, abstract or enum. attributes and
  methods are strings in UML notation, e.g. "- email: String", "+ placeOrder(cart: Cart): Order" (enum values go in
  attributes). Keep each list to the members that matter (max ~8).
- relationships: {from, to, type, label?}: inherits (from = subclass, to = parent), implements (from = class, to =
  interface), composition / aggregation (from = the whole, to = the part), association (label = multiplicity such as
  "1..*"), dependency (from uses to). Parents are placed above their children automatically.
- Up to 80 classes. To change it, call again with the COMPLETE lists.`

export const ER_DESCRIPTION = () => `Draw an entity relationship (ER) / database schema diagram as a live, editable draw.io diagram: tables
with their columns, primary and foreign keys, and crow's-foot relationships. Use it for database designs, data models
and schemas (SQL, migrations, ORM models).

Write title, direction, then ALL entities, then ALL relationships.
- entities: {id, name, fields}. fields: {name, type, pk?, fk?} or strings like "PK id: uuid". Key columns first.
- relationships: {from, to, cardinality, label?} with cardinality one-to-one, one-to-many (from = the "one" side, e.g.
  customers -> orders), many-to-one or many-to-many. The "one" side is placed above the "many" side.
- Up to 80 entities. To change it, call again with the COMPLETE lists.`

export const GENERAL_DESCRIPTION = () => `Draw ANY other connected diagram as a live, editable draw.io diagram: ML / neural-network
architectures (e.g. a Transformer), system context diagrams, data pipelines in the abstract, concept maps, org charts,
layered models. The user watches it build itself. You only describe groups, nodes and connections; the layout (nested
groups placed along the flow with few crossings), icons and orthogonal edge routing are computed deterministically.
For cloud / software infrastructure with real services (AWS, GCP, Azure, SAP, Kubernetes) use create_architecture_diagram.
For flowcharts, processes, workflows, decision trees and approval flows use create_flowchart. For API call flows use
create_sequence_diagram, for lifecycles create_state_diagram, for object models create_class_diagram and for database
schemas create_er_diagram. ${NOT_FOR}

Write the arguments in this order: title, subtitle, groups, nodes, interfaces.
- groups (optional): only the stages / containers the user actually names, in flow order, e.g. [{id:"encoder", title:"Encoder (×N)"}].
  Do not invent groups; without them, nodes are drawn free-standing.
  Nest a group inside another with parent: {id:"ns_api", title:"Namespace api", parent:"cluster"}.
- nodes: {id, title (the user's wording), detail (max 8 words), group?, icon?}. Omit group for nodes outside every
  group. Order nodes inside a group along the flow.
  icon (optional) is one of ${GENERAL_ICONS.join(", ")} or any architecture kind (e.g. postgres, aws_lambda, kafka);
  when omitted it is chosen from the wording.
- interfaces: {from, to, label (shown on the edge, max 4 words), description (one sentence)}. Listed F-01, F-02... in the legend.
- Up to 200 nodes; draw everything the user names. Keep loops and residual connections as interfaces; the router keeps them readable.`

export const ANALYZE_DESCRIPTION = () => `Read a real codebase and draw its architecture as a live draw.io diagram.
Use whenever the user names a repository, codebase, project folder or git link ("draw the architecture of this repo",
"diagram org/service", "how is X deployed"). Scans CI/CD workflows, Terraform (google/azurerm/btp), Bicep/ARM, SAP MTA
descriptors (mta.yaml, xs-security.json, xs-app.json, CDS), Cloud Foundry manifests, Dockerfiles, dependencies and
endpoints with file:line evidence (credentials are never read), then an architect model turns that into the diagram
across GCP, Azure, SAP BTP and on-premises. Takes 20-60 seconds. If no model is available to the server, it returns the
evidence and you draw the diagram yourself with create_architecture_diagram. Afterwards summarise the architecture
citing interface numbers (IF-01...) and the evidence.
repository: "." for the current workspace, a folder name or path inside the workspace, "owner/repo" on ${config.githubHost},
or an https git URL.`
