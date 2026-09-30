# Wrapbox prototype

Clickable prototype of Wrapbox — the runtime permit layer for AI agents. Every sensitive agent action is checked against one intent contract right before it runs and answered ALLOW, CONSTRAIN, REVIEW or BLOCK.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/wrapbox.html — a single self-contained page
```

## What's real and what's simulated

- **Real:** the deterministic policy engine (`src/lib/engine.ts`), the YAML contract parser and validator (`src/data/contract.ts`), permit signing and verification with ECDSA P-256 in the browser (`src/lib/permit.ts`), passkey-style approval signatures, and each vendor's documented hook/request/response format (`src/data/scenarios.ts`, matching `hooks/intentos-hook.mjs`).
- **Simulated:** the agents themselves, background traffic, SSO, MDM, Slack and directory sync.

## Signing in

The app opens on a public landing page (`#/landing`). **Sign in** or **Get started** lead to the auth screens: any email works, and the password is the prototype access code. Signed-out visitors are always sent to the landing page.

## Two workspaces

- **Demo** — 30 days of traffic, 12 connected agents, a 14-version contract.
- **Fresh** — completely empty. Everything on every page comes from what you do: admin setup, connecting agents, writing the contract, sending actions from the playground, employee setup, approvals. Saved in `localStorage`; reset it from the workspace menu.

## Layout

- `src/data/agents.ts` — the 8 platform categories and 25 integrations, with their real config snippets
- `src/data/contract.ts` — rule model, policy packs, YAML emit/parse, replay
- `src/data/scenarios.ts` — the scripted happy flows and each agent's native request/response adapter
- `src/lib/engine.ts` — policy evaluation, safe rewrites (CONSTRAIN), command classification
- `src/lib/store.ts` — workspace state (demo + fresh), live traffic, approvals
- `src/pages/landing.tsx` — the public landing page (real app screenshots in `src/assets/shots/`, live policy-engine terminal, pricing)
- `src/pages/auth.tsx` — log in and sign up
- `src/pages/*` — Get started, onboarding, overview, agents, contract, playground, flows, approvals, evidence, team, gateway, settings
- `src/assets/people/` — portraits (Unsplash License, see `CREDITS.md`)
