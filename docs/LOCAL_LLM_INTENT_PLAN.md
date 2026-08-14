# Local LLM — Intent Understanding (small-hardware plan)

> Prepared for the next session. Goal Ashish set: **understand intent, not match keywords.**
> Do NOT keep adding keyword patterns. The local model decides *what the user wants*;
> the existing deterministic handlers do the *computation*. This keeps answers exact and
> compliant while removing the brittle phrase-matching.

## Core idea (why small hardware is enough)
The local model is used ONLY as a lightweight **intent + slot extractor / SQL planner**,
never for prose. Classifying "what does this question want" into a small JSON is a tiny task:
a 3B-class quantized model (Q4) runs fine on **CPU or a 4–8 GB GPU**. Phrasing/answering
stays on the deterministic handlers + Groq (already primary). So no big GPU needed.

Pipeline:
  user question + last 6 turns
     -> LOCAL LLM -> strict JSON intent  e.g.
        {"intent":"topn_over_days","symbols":["IDEA"],"top_n":5,"window_days":30,
         "min_days":null,"mode":"peers"}
     -> ROUTER maps intent -> existing deterministic function (no LLM math)
     -> deterministic result -> (optional) Groq phrasing under GUARDRAILS
  If local model is down/unsure -> fall back to Groq planner (today's path).

## Candidate models (small, instruct, good at JSON)
- Llama 3.2 3B Instruct (Q4_K_M)   ~2 GB, CPU-friendly
- Qwen2.5 3B Instruct (Q4)         strong at structured output
- Phi-3.5-mini (3.8B)              good reasoning for size
Start with Llama 3.2 3B; swap via one setting if needed.

## Runtime: Ollama (OpenAI-compatible)
Our router already supports any OpenAI-compatible base_url (that's how Groq works), so a
local model plugs in as just another provider — minimal code.

## Step-by-step for tomorrow
1. Install Ollama on the EC2 box (or a small separate VM). `ollama pull llama3.2:3b-instruct-q4_K_M`.
2. Confirm the OpenAI-compatible endpoint: http://127.0.0.1:11434/v1  (model id "llama3.2:3b...").
3. Add a "local" provider slot in app_settings (base_url + model + api key "ollama"),
   reusing the existing OpenAIProvider path. Add `llm_task_routing` so task="intent"/"sql_plan"
   use "local" first, everything else stays Groq-primary.
4. Define the INTENT SCHEMA (JSON) + a tight system prompt with 8–12 few-shot examples
   covering: topn_over_days (count | peers | threshold), sector_avg, cheapest/expensive by
   metric, gainers/decliners, score_distribution, portfolio_summary, define/explain, smalltalk.
   Force JSON (Ollama `format:"json"` / grammar).
5. Build the ROUTER: intent -> existing deterministic handler(+params). Keep every current
   handler as-is; they become the execution layer. Unknown/low-confidence -> Groq path.
6. Test harness: a fixed set of paraphrases per intent (incl. the "who is next to idea"
   follow-up) asserting the right handler+params — measures intent accuracy, not keywords.
7. Deploy; monitor Admin -> Assistant quality (thumbs) + add the 👍 answers as few-shot
   examples over time (self-improving intent layer, no retraining needed at first).

## What is already in place (so tomorrow is fast)
- Multi-provider router with base_url support (local = drop-in provider).
- Deterministic handlers: topn_over_days (per-symbol count | peers | threshold) — DONE today.
- Read-only, PII-safe SQL tool (whitelist + user-scoped) for anything handlers don't cover.
- Guardrails (non-removable): no advice, no methodology/schema/PII disclosure.
- Conversation history passed into the handler (context-aware follow-ups) — DONE today.

## Guardrail note
Local model output is JSON only (intent/slots/SQL) — it never writes the user-facing answer,
so it cannot leak internals or give advice. Same GUARDRAILS still wrap any phrasing step.
