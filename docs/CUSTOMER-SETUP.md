# Getting a customer connected (the number flow)

This is the page a customer follows, and the page support reads back to them.
It is short on purpose: every extra step is a step somebody skips.

## 1. The customer installs OraxDesk and reads you their number

The number is nine digits, shown in the library's top bar. It is the only
identifier support ever needs. It is safe to send over a chat: it names a
device in the registry, it does not authenticate anything.

## 2. You add the number to the support inbox

Library → sidebar → the inbox → paste the number → **verify against the
registry** (one button, one pass; it is not a poller). The row then says one of:

| State | What it means | What to do |
| --- | --- | --- |
| reachable | the machine published an address within the last hour | connect |
| no address published | registered, but nothing published | ask them to switch on unattended access, or send an invitation |
| revoked | the operator revoked this device | do not connect |
| not registered | the number is unknown to this registry | check the digits |
| could not be asked | the registry did not answer | check your connection, retry |

"No address published" is not "offline". This build has no presence signal for
a machine it has not connected to, and saying "offline" would be a guess.

## 3a. If nobody is at that machine: unattended access

On the customer's machine: **Get help → Settings → Unattended access**, switch
it on and set a password (or pair this helper once with "let this helper
connect any time"). The machine then publishes its address and a helper can
dial it.

## 3b. If somebody is there: an invitation

On the customer's machine: **Get help → let somebody help me** → send the code.
The code is single use and expires; the person on that machine approves the
session when it arrives.

## 4. What the customer sees, and what they can refuse

- Viewing starts only after approval (or after the unattended password).
- **Commands and files are a separate permission**, granted per session, and
  can be taken back at any moment while the session runs. Until then, an agent
  asking to run something is refused, and nothing ran.
- The "agent driving" badge is on the pane whenever an agent, not a person,
  holds control. Taking the wheel is one click, and gives control back the same
  way.

## 5. First-line troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| number not found | they have not registered with this registry | check the registry URL in their app matches yours |
| no address published | unattended access is off, or the app is closed | switch it on there |
| stopped at authentication | this helper was never approved, and no password is set | approve once, or set the unattended password |
| "waiting for approval" | somebody must click on that machine | ask them, or use unattended access |
| commands refused | the person did not tick commands and files | they grant it in the session banner |
| address lookup fails for one machine only | that machine never published | see above; n0 is checked too, so this is a real state |

## 6. What support must never do

- Never ask for the unattended password in a chat.
- Never connect to a machine the customer has not named in this conversation.
- Never leave a session open after the work is done: the person can see it, and
  they are right to.
