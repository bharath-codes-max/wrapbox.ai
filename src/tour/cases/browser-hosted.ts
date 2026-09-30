import type { TourCase } from "../types";

// Priya extends the same rules to agents that never run in a laptop terminal:
// a browser agent (managed extension) and a hosted agent on AWS AgentCore
// (Wrapbox as the gateway's REQUEST interceptor). The Control Room then shows
// how far each plane honestly reaches.
const c: TourCase = {
  id: "browser-hosted",
  order: 106,
  persona: { userId: "u-priya", name: "Priya Menon", role: "Admin" },
  title: "Govern browser and hosted agents",
  goal: "Some of Veridian's agents never touch a laptop terminal: one works in the browser, another runs on AWS. Priya wants the same rules to reach both.",
  outcome: "The browser agent's customer data was tokenized and its $450 order sent to Finance, the hosted agent's mass export was blocked, and the Control Room shows how far each plane really reaches.",
  start: "simlab/browser_hosted",
  poster: 1,
  steps: [
    {
      target: { selector: ".stream-item", text: "Browser agent pastes customer contacts" },
      action: "click",
      title: "An agent in the browser",
      body: "Claude in Chrome, working for Jordan, fills a form on an unapproved AI site with customers' names, emails and phone numbers.",
      say: "Okay, Claude in Chrome, working for Jordan, fills a form on an unapproved AI site with customers' names, emails and phone numbers.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "Same rule as the network",
      body: "Constrained by the same rule the network plane uses: emails and phone numbers become tokens before the page receives them.",
      say: "It's constrained by the very same rule the network plane uses: emails and phone numbers turn into tokens before the page gets them.",
      waitFor: { selector: ".aterm-line", text: "Decision CONSTRAIN" },
      hold: 1600,
    },
    {
      target: { selector: ".stream-item", text: "Browser agent places a $450 order" },
      action: "click",
      title: "Spending money in the browser",
      body: "Then the browser agent clicks “Place order” for $450 of office supplies.",
      say: "Then the browser agent clicks place order, for four hundred and fifty dollars of office supplies.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "Money goes to Finance",
      body: "Held: above the $20 per-action limit. Reviews about money go to Sam Rivera in Finance — never to the person who asked.",
      say: "Held, because it's above the twenty dollar limit. And reviews about money go to Sam Rivera in Finance, never to the person who asked.",
      waitFor: { selector: ".aterm-line", text: "Decision REVIEW" },
      hold: 1800,
    },
    {
      target: { selector: ".stream-item", text: "Hosted agent exports 250,000" },
      action: "click",
      title: "An agent hosted on AWS",
      body: "The Billing Agent runs on AWS AgentCore, not on a laptop. Wrapbox sits in its gateway as the request interceptor, before each tool call reaches its target.",
      say: "Now the Billing Agent, which runs on AWS AgentCore, not on a laptop. Wrapbox sits in its gateway as the request interceptor, before each tool call reaches its target.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "The Safety Kernel applies here too",
      body: "It tries to export 250,000 customer rows — blocked by the Safety Kernel's mass-export rule, exactly as on a laptop.",
      say: "It tries to export two hundred and fifty thousand customer rows, and it's blocked by the Safety Kernel's mass export rule, exactly as it would be on a laptop.",
      waitFor: { selector: ".aterm-line", text: "Decision BLOCK" },
      hold: 1800,
    },
    {
      target: { selector: ".rail-item", text: "Control Room" },
      action: "click",
      title: "How far each plane reaches",
      body: "The Control Room is honest about reach: the browser extension covers managed Chrome and Edge only, AgentCore is enforced, and Google's platform isn't built yet.",
      say: "And the Control Room is honest about reach: the browser extension covers managed Chrome and Edge only, AgentCore is enforced, and Google's platform isn't built yet.",
      waitFor: { selector: "button", text: "Enforcement planes" },
    },
    {
      target: { selector: "button", text: "Enforcement planes" },
      title: "Five planes, one engine",
      body: "Endpoint, network, gateway, browser and hosted: five places Wrapbox can hold an action, one decision engine behind all of them.",
      say: "Endpoint, network, gateway, browser and hosted: five places Wrapbox can hold an action, and one decision engine behind all of them.",
      placement: "left",
    },
  ],
};
export default c;
