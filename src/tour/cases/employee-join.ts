import type { TourCase } from "../types";

// Daniel Kim, a developer, has joined Veridian (the seeded setup checklist marks
// it done). The story is what that means for Daniel's AI coding agent: it is
// registered to Daniel, an everyday request runs untouched, a request for
// secrets is stopped before it runs, and both land on the agent's own record.
const c: TourCase = {
  id: "employee-join",
  order: 15,
  persona: { userId: "u-daniel", name: "Daniel Kim", role: "Developer" },
  title: "A new developer's agent, governed",
  goal: "Daniel Kim has joined Veridian as a developer, and the company needs Daniel's AI coding agent governed without slowing the work down.",
  outcome: "Everyday agent work runs untouched, a grab for secrets is stopped before it runs, and both land on the agent's own record.",
  start: "start",
  poster: 6,
  steps: [
    {
      target: { selector: ".setup-step", text: "An employee joins" },
      title: "A new developer on the team",
      body: "Earlier, Daniel Kim joined Veridian as a developer, and the setup checklist marks it done. Now we follow Daniel's AI coding agent.",
      say: "Daniel Kim has joined Veridian as a developer, and the setup checklist marks it done. Now we'll follow Daniel's AI coding agent, which needs governing without slowing the work down.",
    },
    {
      target: { selector: ".rail-item", text: "Agents" },
      action: "click",
      title: "The coding agent is known",
      body: "Wrapbox lists Claude Code with Daniel as its owner, on the laptop Daniel-MBP, plus its tools and where it can send data. So far: 10 events, 2 blocked.",
      say: "Wrapbox lists Claude Code with Daniel as its owner, on the laptop Daniel M-B-P, along with its tools and where it can send data. So far, ten events, and two were blocked.",
      waitFor: { selector: ".ecard", text: "Claude Code" },
    },
    {
      target: { selector: ".rail-item", text: "Simulation Lab" },
      action: "click",
      title: "Watch the agent at work",
      body: "The Simulation Lab plays an agent's request through Wrapbox. As this note says, the laptop is simulated, but the decision comes from the company's real rules.",
      say: "Okay, let's watch it work. The Simulation Lab plays an agent's request through Wrapbox, and while the laptop is simulated, the decision comes from the company's real rules.",
      waitFor: { selector: ".sim-note", text: "Environments simulated" },
    },
    {
      target: { selector: "[role=tab]", text: "Endpoint" },
      action: "click",
      title: "Actions on a person's laptop",
      body: "Endpoint means actions on a person's own laptop: the files an agent opens and the commands it runs. Every scenario here is Daniel's.",
      say: "Endpoint just means actions on someone's own laptop, like the files an agent opens and the commands it runs. And every scenario here is Daniel's.",
      waitFor: { selector: ".card", text: "Daniel asks Claude Code to fix checkout" },
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "An everyday task just runs",
      body: "Claude Code reads a source file to fix checkout. Wrapbox holds it for a moment, finds the rule that lets coding agents read code, and lets it run.",
      say: "Here's an everyday one. Claude Code reads a source file to fix checkout, and Wrapbox pauses it briefly, finds the rule that lets coding agents read code, and lets it run.",
      waitFor: { selector: ".aterm-line", text: "Decision ALLOW" },
      hold: 2400,
    },
    {
      target: { selector: ".stream-item", text: "Agent reads .env" },
      action: "click",
      title: "Now a riskier request",
      body: "Chasing a config problem, the agent tries to open .env, a file of passwords and keys. 'Right now: BLOCK' predicts it will be stopped under today's rules.",
      say: "Hmm, now a riskier one. Chasing a config problem, the agent tries to open the dot env file, full of passwords and keys, and the forecast says today's rules would stop it.",
      // Keep the spotlight on the picked row: it carries the live "Right now · BLOCK" forecast.
      waitFor: { selector: ".stream-item", text: "Agent reads .env" },
      // Below the row, so the picked scenario's card (Agent reads .env, Run) stays uncovered.
      placement: "bottom",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "Secrets stay locked",
      body: "Wrapbox finds two API keys and a password; the rule against reading secrets files stops it. The agent never sees the file and gets a safer path.",
      say: "Wrapbox finds two A-P-I keys and a password, so the rule against reading secrets files stops it. The agent never sees the file, and it gets a safer path instead.",
      waitFor: { selector: ".aterm-line", text: "Decision BLOCK" },
      hold: 2400,
    },
    {
      target: { selector: ".rail-item", text: "Agents" },
      action: "click",
      title: "Both tries are counted",
      body: "Claude Code now shows 12 events and 3 blocked, up from 10 and 2 before we started. Every request is recorded, with no extra work for Daniel.",
      say: "Back on Agents, Claude Code now shows twelve events and three blocked, up from ten and two. Every request gets recorded, with no extra work for Daniel.",
      waitFor: { selector: ".ecard dd", text: "12 events" },
      pad: 10,
    },
    {
      target: { selector: ".ecard", text: "Claude Code" },
      action: "click",
      title: "The agent's own record",
      body: "Claude Code's record, owned by Daniel, now opens with the two requests we just played: the secrets read blocked, the source read allowed. Earlier history sits below.",
      say: "Nice. Claude Code's record, owned by Daniel, now opens with both requests, the everyday source read allowed and the secrets grab stopped before it ran, with earlier history below.",
      waitFor: { selector: ".drawer div.small", text: "Tried to open the secrets file" },
      hold: 2400,
    },
  ],
};
export default c;
