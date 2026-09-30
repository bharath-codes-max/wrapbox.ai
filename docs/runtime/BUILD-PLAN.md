# Wrapbox: the complete build plan

Written 14 September 2026. Everything needed to turn the prototype into software a company can install and pay for. Nothing left out.

---

## 1. What you are building. One product, three pieces.

There is no separation between "the Runtime" and "security software". Wrapbox **is** security software. The Runtime is the name of one of its three pieces. All three ship together as one product.

| Piece | Where it lives | What it is | Status |
|---|---|---|---|
| **Control Plane** | A website | The web app you already built. Admins open it in a browser. | Exists, needs a real backend |
| **Runtime** | On every laptop and server | A small program that installs once and governs every AI agent on that machine | To build |
| **Gateway** | On the company's network | A program that sits in front of MCP servers, APIs, cloud and databases | To build |

A customer buys one thing called Wrapbox. They install the Runtime on their laptops, run the Gateway once on their network, and manage both from the Control Plane.

---

## 2. What the Runtime actually does, step by step

This is the part that was never explained clearly. Here is exactly what happens on a real machine.

**When the engineer installs it**

1. The installer puts one program on the machine, called `wrapboxd`. It runs as a background service with high privilege, the same way antivirus does.
2. `wrapboxd` creates a private key inside the machine's secure chip. On a Mac that is the Secure Enclave. On Windows it is the TPM. The key can never be copied off the machine.
3. It contacts your Control Plane and says "I am this machine, here is my public key". The Control Plane records the device and sends back the current rules.
4. It starts sending a heartbeat every thirty seconds. That is how your Fleet page knows the machine is alive.

**Then it finds the AI agents by itself**

5. It reads the profile list you already have in the prototype, which says things like "Claude Code is a program called `claude`, its settings live at this path". It searches the machine for each one.
6. For every agent it finds, it writes that agent's own configuration file so the agent will ask Wrapbox for permission before it does anything. The engineer does not install anything per agent. This is the whole product promise.
7. It watches those files. If anyone edits or deletes one, the Runtime notices, records it, and writes the file back.

**Then it enforces, in two layers**

8. **Ceiling.** When the agent tries to run a tool, the agent's own hook fires and asks `wrapboxd`. The daemon checks the rules and answers allow, block, rewrite, or ask a human. The answer includes a reason the AI model can read, so it adapts instead of retrying.
9. **Floor.** Underneath that, the operating system itself stops the agent from reaching files, running commands, or opening network connections it should not. This is the layer that catches an agent with no hooks, or an unknown script someone wrote.
10. Every decision is written to a tamper-evident log on the machine and synced to your Control Plane, which is what fills the Evidence page.

The Floor is the part that has to be written three separate times, because macOS, Windows and Linux each do it differently. That is the whole reason for the three operating systems.

---

## 3. Why three operating systems, and what the virtual machines are for

The Ceiling is the same code everywhere. It just writes config files and answers questions. Easy.

The Floor is different on every operating system, because each one has its own way of controlling programs:

| Operating system | How the Floor works there |
|---|---|
| macOS | Seatbelt sandbox for confinement, plus a Network Extension that sees every connection |
| Linux | bubblewrap and seccomp for confinement, plus eBPF to see which program opened which connection |
| Windows | A locked-down local user account, fenced by Windows Filtering Platform rules |

None of that code is shared. Three implementations, three sets of tests.

**Your test machines**

| Operating system | What you use | Cost |
|---|---|---|
| macOS | Your own MacBook. You already have it. | Free |
| Linux | A virtual machine on your Mac | Free |
| Windows | A virtual machine on your Mac | Free |

A virtual machine is a complete computer running in a window on your Mac. Windows genuinely believes it is running on a PC. You get a free program called UTM, download the Windows and Ubuntu installers, and you have three test computers on one desk.

**Why virtual machines and not real computers.** You can break them and restore them in seconds. Testing security software means deliberately doing bad things, so you want a machine you can throw away. It also costs nothing versus buying a PC.

**What I actually do inside them.** I install the Runtime. I install Claude Code or Cursor. I ask the agent to read a secrets file. I confirm it is refused, that the refusal reason appears in the agent, and that the decision shows up on your Fleet and Evidence pages. Then I try to defeat it: edit the config file, kill the daemon, run a script with no hooks at all, strip the proxy settings. Each one has to fail. That is the test suite.

---

## 4. Signing the software, on all three operating systems

I missed Linux entirely last time. Here is the complete picture.

Signing is proof the software came from you and was not altered. Without it, the operating system shows a scary warning or refuses to install.

| Operating system | What you need | Cost | Notes |
|---|---|---|---|
| **macOS** | Apple Developer Program | $99 yearly | The signing certificate and notarization are both included. Nothing extra to buy. |
| **Windows** | EV code signing certificate | $350 to $700 yearly | Comes on a USB token posted to you, or a cloud signing service. Needs the company registered. |
| **Linux** | A GPG key you create | **Free** | You make the key on your own computer. Customers add your public key once when they add the repository. No certificate authority, no company needed, no cost. |

**Good news on Windows.** Because we use Windows Filtering Platform and an isolated account rather than a kernel driver, you avoid Microsoft's hardware certification programme completely. That would have cost thousands and taken months. We do not need it.

**One trap on Windows. It does not remove Windows.** Microsoft has a cheap signing service at about ten dollars a month, but it only accepts companies that have existed for three years. A brand new Delaware company does not qualify yet, so you buy the ordinary certificate at $350 to $700 instead. That is the whole consequence: one line of cost, not a dropped platform. Windows ships alongside macOS and Linux from day one, and you can move to the cheap service in year three if you still want to.

---

## 5. Complete costs, nothing missed

### 5.1 To build the software

| Item | Cost | When | Required? |
|---|---|---|---|
| GitHub | $0 | Now | Already have it |
| Railway hosting, free tier | $0 | Now | Yes |
| wrapbox.ai domain | $80 yearly | Now | Yes |
| wrapbox.dev domain | $14 yearly | Now | Yes |
| UTM and the virtual machines | $0 | Week 1 | Yes |
| Apple Developer Program | $99 yearly | Week 2 | Yes for macOS |
| Linux GPG signing key | $0 | Week 6 | Yes for Linux |
| Windows EV certificate | $350 to $700 yearly | Week 10 | Yes for Windows |
| Okta developer tenant | $0 | Week 4 | For testing login |
| Microsoft 365 developer tenant | $0 | Week 4 | For testing Intune |
| Jamf trial | $0 | Week 4 | For testing Mac rollout |
| Stripe test account | $0 | Week 4 | For testing payments policy |
| Slack workspace | $0 | Week 4 | For approval messages |
| Sentry error tracking, free tier | $0 | Week 3 | Yes |
| Hosting once it is real | $20 to $50 monthly | Month 2 | Yes |

**Total to have working software on three operating systems: about $700 in the first year.**

### 5.2 To have a company

| Item | Cost | Type |
|---|---|---|
| Delaware C-Corp through Stripe Atlas | $500 | One time |
| EIN tax number | $0 | Included in Atlas |
| Mercury bank account | $0 | Free |
| D-U-N-S number | $0 | Free, takes up to 4 weeks |
| Delaware franchise tax and annual report | $225 to $450 | Every year, due 1 March |
| Registered agent from year two | $50 to $100 | Yearly |
| Accountant for Form 1120 and Form 5472 | $1,000 to $2,500 | Yearly |
| India overseas investment filing, if you live in India | ₹25,000 to ₹50,000 | One time, a chartered accountant does it |

**Total for the company in year one: about $2,000 plus the India filing.**

### 5.3 To run the business day to day

| Item | Cost | Notes |
|---|---|---|
| Google Workspace email | $6 per person monthly | You need a proper company email address |
| PostHog analytics, free tier | $0 | See who uses what |
| Resend or Postmark for sending email | $0 to $20 monthly | Invites, alerts, password resets |
| Status page, free tier | $0 | Customers expect one |
| Password manager | $8 monthly | You will hold signing keys and certificates |
| Database backups | Included in hosting | Do not skip this |
| GitHub Actions for automated builds | $0 | Free tier is generous |

### 5.4 To sell to a large company. Deferred, not now.

| Item | Cost | When it becomes necessary |
|---|---|---|
| Outside security test | $15,000 to $40,000 | When a buyer asks who audited you |
| SOC 2 Type II, tooling plus auditor | $23,000 to $37,000 first year | When procurement demands the report |
| Cyber and errors insurance, for when your software breaks their systems | $1,500 to $5,000 yearly | When a contract requires proof of cover |
| Privacy policy and data agreement | $0 to $3,000 | Before the first customer signs |
| Trademark on the name | $350 to $2,000 | Optional, do it when you have revenue |
| Vulnerability disclosure page | $0 | Write it yourself, one page |

**The insurance line, in plain words.** Wrapbox sits between every AI agent and the things it touches. If a release of yours wrongly blocks a customer's production deploy, or wrongly lets an agent through and something leaks, the damage is theirs and the fault is yours. Two covers answer that. Errors and omissions pays when your product fails to do what you sold it to do. Cyber liability pays when a breach runs through your software. Together they run $1,500 to $5,000 a year at your size, and a broker such as Vouch or Embroker writes both on one policy. You do not buy it to be safe. You buy it because a bank's contract will name a dollar figure you must be insured for, and without the certificate the deal stops there. Until a contract asks, the money is better spent on the build.

### 5.5 The three numbers that matter

| Milestone | Total spend | What you can do |
|---|---|---|
| Working software on three operating systems | About $700 | Demo it, give it to friends |
| Company formed, can take money | About $2,700 | Sell to startups and small teams |
| Enterprise ready | $45,000 to $75,000 | Sell to banks, insurers, large tech |

The third number is paid out of revenue from the second. You never pay it up front.

---

## 6. The plan, week by week

### Weeks 1 to 3. The Control Plane becomes real.

I build a backend in the same repository: device enrolment, heartbeat, signed rule bundles, an evidence store, login. Postgres on Railway. The web app you already have stops reading fake data and starts reading the database.

**Done when:** a device that is not in the seed file appears on your Fleet page.

### Weeks 3 to 5. The Runtime core.

One program, three builds. Enrolment, heartbeat, agent discovery, config writing, the hook shim. This is the Ceiling, and it works the same on all three operating systems.

**Done when:** you install it on your Mac, open Claude Code, try to read a secrets file, and it is refused with a reason, and the decision appears in your browser.

### Weeks 5 to 6. Linux and Windows, Ceiling only.

The same program built for the other two operating systems, tested in the virtual machines.

**Done when:** three real machines, three operating systems, one set of rules, all visible on one page.

### Week 6. Evidence.

Tamper-evident logging on the device, synced up, exported to Splunk and Datadog in the formats security teams already use.

**Done when:** a decision made on your Mac appears in a test Splunk account.

### Weeks 7 to 9. The Gateway.

The network piece. A single MCP endpoint that sits in front of the real ones, plus a proxy for ordinary APIs. Same rules engine as the device.

**Done when:** an agent reaches Stripe through your Gateway and the call is governed.

### Weeks 9 to 10. The credential broker.

Real secrets move into a vault. Agents get short-lived tokens instead. Revoking a token cuts that agent off immediately.

**Done when:** an agent completes a real API call with no API key anywhere on the machine.

### Weeks 10 to 12. Receipts.

Approved actions carry a signed token. The destination checks it before acting. Small libraries for Node, Go and Python, plus a GitHub App.

**Done when:** a push to a protected branch is refused because the daemon was stopped and no receipt could be issued.

### Weeks 12 to 16. The Floor.

The operating system layer, written three times. Linux first because it is the easiest and also where servers live. Then macOS. Then Windows.

**Done when:** an unknown Python script calling an AI model is blocked on all three operating systems.

### Weeks 16 to 18. Installers.

Signed and notarized `.pkg` for Mac, signed `.msi` for Windows, GPG-signed apt and rpm repositories for Linux, plus the profiles an IT team pushes from Jamf or Intune.

**Done when:** an IT admin pushes one package and a machine enrols with nobody touching it.

### Weeks 18 onward. Beta.

Three to five friendly companies install it. You watch what breaks. You fix it. Then you decide whether to spend on the audit.

---

## 7. What you must do, and when

### Today. Free, twenty minutes.

1. Say go.
2. Confirm the domains. Do you own wrapbox.ai and wrapbox.dev already?
3. Make a Railway account at railway.app, sign in with GitHub.

That is all. Same repository, no new GitHub organisation, I was wrong about that.

### Week 1. Free, one hour.

Install UTM from mac.getutm.app. Install Windows 11 and Ubuntu inside it. I send you the exact steps. You do this because the operating system asks for permission on screen and only you can click it.

### Week 2. About $600.

1. Incorporate the Delaware C-Corp through Stripe Atlas.
2. Apply for the free D-U-N-S number the same day, because it takes up to four weeks and the Apple Organization account needs it.
3. Buy the Apple Developer Program membership.
4. File the Endpoint Security entitlement request. I write the text, you submit it. Apple takes one to three months.
5. If you live in India, speak to a chartered accountant about reporting the overseas investment.

### Week 4. Free, one hour.

Create the test accounts: Okta developer, Microsoft 365 developer, Jamf trial, Stripe test mode, a Slack workspace. I send the links.

### Week 10. About $500.

Buy the Windows EV certificate once the company papers exist.

### Month 5 or later, only if customers ask.

The security test, SOC 2, and insurance.

---

## 8. Everything else a new startup needs that nobody mentions

- **A company email address.** Google Workspace, six dollars a month. You cannot send sales email from a personal address.
- **A security contact.** A page saying `security@wrapbox.ai` and how to report a bug in your product. Security buyers check for this.
- **Terms of service and a privacy policy.** A template is fine at first. A lawyer before the first real contract.
- **Backups you have actually restored once.** Untested backups are not backups.
- **Somewhere safe for the signing keys.** If someone steals your Windows certificate they can sign malware as you. Hardware token in a drawer, password manager for the rest.
- **An accountant before the first tax deadline.** Form 5472 carries a twenty five thousand dollar penalty if a foreign-owned Delaware company forgets it.
- **A changelog and a status page.** Customers running security software on their laptops will ask what changed and whether you are up.
- **Someone other than me reviewing the security.** I will write it carefully and test it hard, but I should not be the only reviewer of a security product. That is what the outside test buys you.

---

## 9. What could go wrong, and the answer

| Risk | What happens | The answer |
|---|---|---|
| Apple refuses the deep permission | macOS Floor is weaker | Fall back to the Network Extension, which needs no approval and still catches model traffic. Product still works. |
| The D-U-N-S number is slow | Apple Organization account delayed | Start it in week 2, not week 10. Nothing else is blocked. |
| Windows certificate needs company papers | Windows installer delayed | Incorporate in week 2 so the papers exist by week 10. |
| An agent vendor changes its config format | One agent stops being governed | Profiles are data, not code. You change a file, not the program. This is already how the prototype works. |
| Nobody wants it | You stop | You stopped at about $700 and you own working software. |

---

## 10. The honest summary

Spending about $700 gets you real software running on three operating systems in roughly four months. Spending another $2,000 gives you a company that can take money. Only when a large customer demands proof do you spend the big money, and by then you have revenue.

Nothing on this list blocks starting today except one sentence from you.
