# E36: what in the owner's real conversations is worth remembering

Status: **frozen 2026-10-02**, before any message is labeled or embedded.

## Question

E35 showed that keeping only the user's words loses little on LongMemEval.
That benchmark is built from questions about past chats, so it cannot say
whether real conversations hold anything worth remembering. This experiment
looks at the owner's own Claude Code conversations and asks two things:

1. **How much is durable?** What share of the user's messages carries
   information that would still help in a later, different conversation?
2. **How often does the user repeat it?** How often does a message restate
   durable information already given in an earlier conversation the model
   could no longer see? Each such case is something a memory would have
   saved.

The owner gave permission to read the transcripts on 2026-10-02.

## Data

- **Source:** every main transcript in `~/.claude/projects/*/*.jsonl` at
  freeze time: 9 sessions in 8 projects, 2026-09-27 to 2026-10-02.
- **Excluded:** subagent transcripts, because those are agent prompts, not the
  user.
- **A message** is a `user` entry that is:
  - not a sidechain, not meta, not a compact summary, and not a tool result;
  - not a command, task notification or interruption marker;
  - not empty after `<system-reminder>` blocks are removed.
- **Count:** the extraction rule gives 319 messages. Only this count was
  looked at before freezing.
- **Long messages** are cut to their first 2,000 characters for labeling.
- **Privacy:**
  - Messages, embeddings and labels stay in `data/`, which is gitignored.
  - Only aggregate numbers and paraphrased examples are committed.
  - Nothing is sent to any API except the labeling agents of this Claude
    session.

## Out of context

An earlier message m′ is **out of context** for message m when either:

- m′ is in a different session; or
- m′ is in the same session with a compaction boundary between m′ and m.

In both cases the model answering m could no longer see m′.

## Candidates

- **Embeddings:** each message is embedded with bge-m3 (local Ollama, as in
  E19).
- **Candidates for m:** the 3 most similar earlier out-of-context messages, by
  cosine similarity. There is no threshold.
- **Labeling scope:** the labeler judges restatement only against these
  candidates, so restatements that embeddings miss are not counted. The
  measured rate is therefore a lower bound.

## Labels

The labels are assigned by Claude subagents with fresh context. Each gets only
the instructions below and the messages, not this protocol's hypotheses or
thresholds. The rules are fixed here:

- **durable** (yes/no): the message contains information that would still be
  useful to an assistant in a later, different conversation with this user:
  - how the user wants the assistant to work (a correction or a rule);
  - a preference;
  - a decision and its reason;
  - a fact about the user, their environment, tools, paths or projects.

  A one-off task instruction ("run the tests", "fix this"), a question, an
  approval ("yes, do it") or chat is not durable, unless it also carries such
  information.
- **kind** (when durable): `correction`, `preference`, `decision`, `fact`,
  `other`. The most important one is chosen.
- **restates** (yes/no): the message repeats durable information that one of
  the shown earlier messages already gave. Restating only the task does not
  count.

## Metrics

- **D:** durable messages ÷ all messages.
- **Kinds:** the distribution of `kind`.
- **R:** messages that restate ÷ durable messages; the absolute count is also
  reported.
- **Projects and kinds:** both are reported for D and R. Examples are
  paraphrased.

## Decision rule

- **K1, repetition happens:** at least 10 restatements in the data, or
  R ≥ 15%.
  - **Passes:** memory would save the owner real repetition. Build capture of
    the user's words, verbatim, into short-term memory with decay (E35).
  - **Fails:** no automatic capture now. Memory stays explicit (`remember`
    and imports). Re-check when a month of transcripts exists.
- **Noise share (design input, not a gate):** if D < 25%, at least three in
  four captured messages are noise. Capture must then go to the short-term
  level with decay, never straight to long-term.

## Limits stated in advance

- **Small and narrow data:** one user, 6 days, 319 messages, mostly work on
  Aura. One week is too short for much repetition, which biases R downward.
- **Claude labels the owner's messages.** The labelers are Claude models from
  the same family as the designer, not independent people.
- **Only embedding candidates are checked**, so R is a lower bound.
- **Claude Code only.** Conversations in other AI tools are not on disk.

## Freeze record

`run.py` sha256 `4d8bf4881177af0fc0240bbed8de333eac1032f3efc5a65adc238ebe9d603a48`. Project names are kept in `data/by_project.json` only.
