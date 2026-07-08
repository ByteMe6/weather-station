# Weather Station — Project Kickoff Guide

This is our reference for how we start and run this project. We'll work through these eight
steps in order, and review together at the end of each one before moving on.

A note before you start: **expect to loop backward.** Research will reshape the idea,
architecture will reshape scope — that's normal, not a mistake. Treat each doc as a living
draft, not something locked.

---


## Step 1 — Problem statement & idea

Before anything else, start with the *problem*, not the solution. It's easy to get attached
to a feature you think is cool and lose sight of whether it actually matters — so let's
anchor on the problem first.

Write down:

- **Who** has this problem
- **What pain** it causes them today
- **How they solve it now** (even if the answer is "a spreadsheet" or "they just live with it")

Then sum it up in one sentence: *"We're building X for Y so they can Z."*

If you can nail that sentence clearly, the rest of the project gets a lot easier. If you
can't, that's a signal the idea needs more thinking before we move on.

---

## Step 2 — Research & market research

Now let's pressure-test the idea against reality. Your job here is to find out whether this
problem is real and whether anyone's already solving it.

Look into:

- **Competitors and alternatives** — including the boring ones like spreadsheets, manual
  workarounds, or "doing nothing." Note what they do well and where they fall short.
- **Your target user** — who exactly are they? Be specific.
- **Demand signal** — is there evidence people actually want this? (forums, complaints,
  search volume, people paying for alternatives)
- **Constraints** — anything technical, legal, or regulatory that affects what we can build.

End this with one clear paragraph: *why build this, and why now?* Point to the specific gap
you're filling. If you can't find a gap, come talk to me before going further.

---

## Step 3 — Scope / MVP

This is the most important habit to build, so take it seriously. Almost every first project
dies from trying to do too much.

Write two lists:

- **In scope** — what we're building
- **Out of scope** — what we're deliberately *not* building yet

Then define the **MVP**: the smallest version that still delivers real value to the user.
Once you've written your first version of this, cut it in half. I'm serious — your first
instinct will be too big.

The goal isn't to build everything. It's to build the one thing that proves the idea works.

---

## Step 4 — PRD (Product Requirements Document)

This is the contract for what we're building. Anyone should be able to read it and understand
what the product does.

Include:

- **Goals and non-goals** — what success looks like, and what we're explicitly not trying to do
- **User stories / use cases** — "As a [user], I want to [action] so that [outcome]"
- **Functional requirements** — what the system must do
- **Success metrics** — how do we *know* it's working?
- **Non-functional requirements** — performance, security, auth, scale
- **Key user flows** — the main paths a user takes
- **Open questions & assumptions** — write down what you're unsure about

Don't aim for perfect. Aim for clear. We'll review it together before you move on.

---

## Step 5 — Architecture & system design

Before you pick any tools, design the system on paper. You should be able to explain how it
works without naming a single library.

Sketch out:

- **Components** — the main pieces and how they connect
- **Data model** — your main entities and how they relate
- **API surface** — the key endpoints/operations
- **Data flow** — how information moves through the system
- **External integrations** — anything you depend on
- **State** — where data lives and how it's stored

Whiteboard it, take a photo, whatever works. If you can't draw it, you don't understand it
well enough yet.

---

## Step 6 — Tech stack

*Now* you pick your tools — and each choice should serve the architecture you just designed,
not the other way around.

List your choices for language, framework, database, hosting, and key libraries. Next to each
one, write a single line on **why**.

The rule: justify every choice against an actual requirement. "I already know it" is a valid
reason — but say so honestly. "It's trendy" is not. If a simpler tool does the job, pick the
simpler tool.

---

## Step 7 — Phases / roadmap

Break the work into milestones, not calendar dates (dates always slip — milestones keep you
honest).

- **Phase 1 = MVP** that proves the core flow end-to-end
- **Later phases** add the scope you deferred earlier

Each phase should be something you can actually ship or demo on its own. If a phase doesn't
produce something you can show, it's too big or split wrong.

---

## Step 8 — Tickets

Finally, break the phases into tickets — the actual units of work.

Each ticket should have:

- A **clear title**
- A short **description** of what and why
- **Acceptance criteria** — how we know it's done
- **Dependencies** — what has to happen first

Keep them small — ideally under a day of work each. A vague ticket leads to vague work and
surprises later. If you can't write clear acceptance criteria, the ticket isn't ready yet.

---

## How we'll work together

- Work through the steps **in order**.
- **Review checkpoint after each step** — don't write all eight docs and dump them on me at
  once. Cheaper to correct early.
- Keep every doc in this `weather-station/docs/` folder so we can track our work.
