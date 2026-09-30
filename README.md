# Wrapbox Real Prototype

A completely isolated, high-fidelity **interactive product simulation** of the complete Wrapbox
product described in the *8-Week Product, Security & Architecture Blueprint*. It exists to show
what the finished product **is, does, and feels like** — for investor demos, enterprise customer
demos, design-partner discussions and UX validation.

> **This is not the real Wrapbox engineering implementation.** The real implementation
> (Network Extension, wrapboxd, control plane, Core Brain work) lives in the parent repository and
> is untouched by this project. This folder is its own git repository; its commits never mix into
> the parent.

## Run

```bash
npm install
npm run dev        # http://localhost:5980  (port chosen to never clash with the main app)
npm test           # 15 engine outcome tests (node:test via tsx)
npm run build      # type-check + production build
```

## What is real vs simulated

**Real (live behavior):** the decision engine (Intent Contract clauses, Safety Kernel precedence,
Blast-Radius Governor, Context Engine, Task Envelope), all state transitions (approve/deny/constrain,
park/resume, break-glass expiry), transformations (payloads genuinely change; reversible tokens
genuinely appear in the Token Vault), every dashboard counter (derived from the event store),
policy changes genuinely changing outcomes, per-event evidence chains with linked hashes.

**Simulated (representative):** every integration — GitHub, SQL, AWS, MCP, SSO, macOS Endpoint
Security, the Network Extension — plus detector/OCR/semantic analysis results, the fictional
Veridian Systems organization, and evidence signing (illustrative hash chain, not cryptography).

## Architecture

```
src/model/      types (one SimulationEvent for every surface), registries, org, seed contracts
src/engine/     brain.ts (single decide() — safety kernel > contracts > blast radius > context
                > envelope), scenarios.ts (structured scenario library), simulate.ts (event +
                transform + evidence + pipeline builder)
src/state/      store.ts — single source of truth, localStorage persistence, task engine
src/ui/         design system kit, event detail drawer, filterable stream
src/pages/      one file per product screen
tests/          engine outcome tests (§59 of the build brief)
```

Adding a scenario = adding one structured entry to `src/engine/scenarios.ts`. No screen keeps its
own copy of policy or events; a BLOCK in the Simulation Lab is the same event the Control Room,
Live Actions, Agent Inventory, Review Center and Evidence render.

## Screens

Control Room · Live Actions · Agents · Tasks (Task Envelope + park/resume) · Intent Studio
(+ Policy Autopilot) · Safety Kernel · Policy Simulator (Shadow Mode) · Review Center (bundles) ·
Standing Permissions · Break Glass · Coverage Map · Trust Graph · Evidence Explorer (+ causal
graph) · Simulation Lab (Network / Endpoint / Gateway / Context / Safety, side-by-side reality
view) · Integrations (+ Action Ontology) · Token Vault · Core Brain · Settings · guided Demo Mode.
