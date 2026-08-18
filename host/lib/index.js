/**
 * Reasoning Effort Bridge — host half.
 *
 * Third-party models served by `llm-pi-ai` expose selectable thinking-effort
 * levels to the composer's model menu ONLY when their profile entry declares
 * `reasoningEfforts`. Hand-declared gateway routes (the usual way third-party
 * platforms are added) start without the field, so the stock ModelSelect never
 * renders its effort row for them — while official llm-deepseek models always
 * show theirs.
 *
 * This plugin closes that gap at the one honest seam. For every model that
 * currently reports NO reasoning metadata (`llm.resolveModelInfo` →
 * `reasoning === undefined`, exactly the condition under which the composer
 * hides its effort row), and whose route speaks a wire protocol that accepts
 * the level-name spellings, it writes the default six-level map into the user
 * layer of the `llm-pi-ai` settings namespace:
 *
 *   { off: 'none', low: 'low', medium: 'medium',
 *     high: 'high', xhigh: 'xhigh', max: 'max' }
 *
 * The wire spellings are the level names themselves — exactly what pi-ai's own
 * catalog uses for OpenAI-style routes (gpt-5.1+ entries map `off` to the wire
 * value `"none"`, and low/medium/high/xhigh/max map to their own names), and
 * what pi-ai's anthropic-messages path accepts for Claude-style routes
 * (opencode's catalog maps `xhigh`/`max` the same way). Selecting a level then
 * dispatches a genuine request parameter (`reasoning.effort` on
 * openai-responses, `reasoning_effort` on openai-completions); selecting Off
 * makes pi-ai send the model's `off` wire value (`"none"`), matching how
 * pi-ai already treats official OpenAI catalog models. Undeclared levels keep
 * being refused by llm-pi-ai before any network I/O.
 *
 * Honesty and safety rules:
 * - A model that ALREADY reports reasoning metadata (a user-declared map, or
 *   a catalog entry carrying its own capability) is never touched: pi-ai's
 *   catalog stays authoritative for the levels it knows. An explicit
 *   `reasoningEfforts: false` in the user layer is equally untouched — it is
 *   a declaration, and this bridge only fills absent fields.
 * - Only entries in the RAW USER layer are filled (`settings.describe()` →
 *   `user`), submitted as whole rebuilt `models` arrays through
 *   `settings.update()`. The settings path-op walker cannot address array
 *   elements (its intermediate-object step would clobber an array into an
 *   object before the schema refuses it), and `modelOverrides` is refused
 *   beside a `models` list — so a patch-level array replace over the user's
 *   own snapshot is the one seam that both validates and preserves every
 *   other field.
 * - The write carries the descriptor's `expectedRevision`: a concurrent user
 *   edit refuses the whole write (SETTINGS_CONFLICT) instead of being
 *   clobbered, and the change that won re-triggers this plugin through
 *   `settings/updated`.
 * - Writes pass llm-pi-ai's own schema + serviceability validation, and this
 *   plugin's own successful write re-triggers the watcher with nothing left
 *   to fill — no update loop.
 *
 * Plain ESM JavaScript (no build step): the DSH loader resolves `apply` from
 * this module.
 */

export const name = 'reasoning-effort-bridge'

/** Hard dependencies: the plugin's whole job is reading/mutating settings. */
export const inject = ['settings']

/** The settings namespace owned by llm-pi-ai. */
const NS = 'llm-pi-ai'

/**
 * Wire protocols whose reasoning dispatch accepts the level-name spellings.
 * Anything else (google-generative-ai, bedrock, mistral, pi-messages, ...) is
 * left untouched — those protocols were not verified here.
 */
const BRIDGED_APIS = new Set([
  'openai-responses',
  'openai-completions',
  'azure-openai-responses',
  'openai-codex-responses',
  'anthropic-messages',
])

/**
 * Default level map. Keys are the selector levels the stock ModelSelect then
 * offers (Off/Low/Medium/High/Xhigh/Max — `minimal` stays hidden); values are
 * the wire spellings, mirroring pi-ai's own catalog entries.
 */
const DEFAULT_EFFORTS = Object.freeze({
  off: 'none',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
})

/** Startup polling: how often / how long to retry before the namespace appears. */
const POLL_INTERVAL_MS = 2500
const POLL_MAX_TRIES = 48 // ~2 minutes; event-driven mode stays active afterwards.

/** Plain-object guard (settings sections are parsed JSON/YAML objects). */
function isPlain(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Find the descriptor of one namespace inside a `settings.describe()` result.
 * `user` is present only when the stored document has a section for the
 * namespace; absent means "nothing user-owned to fill". The whole descriptor
 * is returned so the write can carry its `revision` as `expectedRevision`.
 */
function descriptorOf(descriptors, ns) {
  if (!Array.isArray(descriptors)) return undefined
  const hit = descriptors.find(descriptor => isPlain(descriptor) && String(descriptor.ns) === ns)
  return isPlain(hit) && isPlain(hit.user) ? hit : undefined
}

/**
 * Whether one model entry in the RAW user layer is fillable.
 * `false` is an explicit "non-reasoning model" declaration — never refilled.
 */
function isFillableEntry(entry) {
  return isPlain(entry) && entry.reasoningEfforts === undefined
}

/**
 * Build the settings update patch that fills default reasoning efforts.
 *
 * `section` is the RESOLVED namespace value (schema defaults merged over the
 * composition base over the user layer) and supplies route-level facts such
 * as the wire protocol. `userSection` is the RAW user layer; arrays are
 * rebuilt from IT, so the patch only ever contains structures the user
 * already owns — a route whose models live entirely in a composition base is
 * skipped rather than being shadowed.
 *
 * A model is filled only when `probeNoReasoning(routeId, modelId)` resolves
 * true (the model currently exposes no reasoning metadata — the exact
 * condition under which the composer hides its effort row). A probe rejection
 * skips the model for this pass; the event that re-registers adapters
 * re-probes it.
 *
 * @param section - the resolved `llm-pi-ai` section.
 * @param userSection - the raw user layer of the same namespace.
 * @param probeNoReasoning - async (providerId, modelId) => boolean.
 * @returns `{ patch, filled }` or undefined when there is nothing to fill.
 */
export async function buildFillPatch(section, userSection, probeNoReasoning) {
  if (!isPlain(section) || !isPlain(section.providers)) return undefined
  if (!isPlain(userSection) || !isPlain(userSection.providers)) return undefined
  if (typeof probeNoReasoning !== 'function') return undefined
  let filled = 0
  const patchProviders = {}
  for (const [routeId, profile] of Object.entries(section.providers)) {
    if (!isPlain(profile)) continue
    // Route-level protocol decides whether level-name wire spellings apply.
    if (!BRIDGED_APIS.has(String(profile.api))) continue
    const userRoute = userSection.providers[routeId]
    if (!isPlain(userRoute) || !Array.isArray(userRoute.models)) continue
    let touched = false
    const models = []
    for (const entry of userRoute.models) {
      if (!isFillableEntry(entry)) {
        models.push(entry)
        continue
      }
      let noReasoning = false
      try {
        noReasoning = await probeNoReasoning(routeId, String(entry.id))
      } catch {
        noReasoning = false
      }
      if (!noReasoning) {
        models.push(entry)
        continue
      }
      touched = true
      filled += 1
      models.push({ ...entry, reasoningEfforts: { ...DEFAULT_EFFORTS } })
    }
    if (touched) patchProviders[routeId] = { models }
  }
  if (filled === 0) return undefined
  return { patch: { providers: patchProviders }, filled }
}

/**
 * Plugin body: schedule one fill pass on startup (with bounded retry polling
 * until llm-pi-ai's namespace registers), then stay event-driven on
 * `settings/updated` (user edits, file reloads, this plugin's own writes) and
 * `llm/adapters-updated` (route registration changes).
 * @param ctx - host root context.
 */
export function apply(ctx) {
  const log = ctx.logger
  let running = false
  let queued = false
  let stopped = false

  const runFill = async () => {
    const settings = ctx.get('settings')
    if (settings === undefined) return false
    let section
    try {
      section = settings.get(NS)
    } catch (error) {
      log.warn('reasoning-effort-bridge: reading the "llm-pi-ai" settings section failed')
      log.warn(error)
      return true
    }
    // llm-pi-ai has not registered its namespace yet (still starting, or not
    // installed): keep polling, nothing to do right now.
    if (section === undefined) return false
    let descriptor
    try {
      descriptor = descriptorOf(settings.describe(), NS)
    } catch (error) {
      log.warn('reasoning-effort-bridge: describing settings failed')
      log.warn(error)
      return true
    }
    if (descriptor === undefined) return true
    const llm = ctx.get('llm')
    if (llm === undefined) {
      // Without the llm registry the "already reports reasoning" probe cannot
      // run; a later adapters-updated event retries.
      return true
    }
    /**
     * A model exposes no reasoning metadata iff the composer would hide its
     * effort row. A rejected probe (route mid-re-registration) answers false —
     * skip this pass — and the adapters-updated event re-probes.
     */
    const probeNoReasoning = async (providerId, modelId) => {
      const info = await llm.resolveModelInfo(providerId, modelId)
      return !isPlain(info) || info.reasoning === undefined
    }
    const result = await buildFillPatch(section, descriptor.user, probeNoReasoning)
    if (result === undefined) return true
    try {
      await settings.update(NS, result.patch, descriptor.revision)
      log.info(`reasoning-effort-bridge: filled default reasoning efforts for ${result.filled} model`
        + `${result.filled === 1 ? ' entry' : ' entries'} in "llm-pi-ai" (Off/Low/Medium/High/Xhigh/Max)`)
    } catch (error) {
      // A refused write keeps the stored section intact; the next relevant
      // event retries (a conflict means some other write won, and that write
      // itself re-triggers this watcher).
      log.warn('reasoning-effort-bridge: filling reasoningEfforts was refused (will retry on the next settings/adapter change)')
      log.warn(error)
    }
    return true
  }

  /** Coalesce concurrent triggers into one pass; re-run once if more arrived. */
  const schedule = () => {
    if (stopped) return
    if (running) {
      queued = true
      return
    }
    running = true
    void runFill()
      .catch(error => {
        log.warn('reasoning-effort-bridge: a fill pass failed')
        log.warn(error)
      })
      .then(() => {
        running = false
        if (queued && !stopped) {
          queued = false
          schedule()
        }
      })
  }

  // Startup: run immediately, then poll briefly until llm-pi-ai's namespace
  // registers (it appears when the llm-pi-ai plugin applies, which may be
  // after this plugin). Once seen — filled or not — polling stops and the
  // event listeners own every later change.
  let polls = 0
  let pollHandle = undefined
  const poll = () => {
    if (stopped) return
    polls += 1
    const settings = ctx.get('settings')
    let ready = false
    try {
      ready = settings !== undefined && settings.get(NS) !== undefined
    } catch {
      ready = false
    }
    schedule()
    if (ready || polls >= POLL_MAX_TRIES) {
      if (pollHandle !== undefined) {
        clearInterval(pollHandle)
        pollHandle = undefined
      }
      if (!ready) {
        log.warn('reasoning-effort-bridge: the "llm-pi-ai" settings namespace did not appear;'
          + ' startup polling gave up (event-driven mode stays active)')
      }
      return
    }
  }
  ctx.effect(() => {
    pollHandle = setInterval(poll, POLL_INTERVAL_MS)
    poll()
    return () => {
      stopped = true
      if (pollHandle !== undefined) clearInterval(pollHandle)
    }
  }, 'reasoning-effort-bridge: startup polling')

  // User edits and file reloads (and this plugin's own write, which finds
  // nothing left to fill and therefore does not loop).
  ctx.on('settings/updated', (ns) => {
    if (String(ns) === NS) schedule()
  })
  // Route registrations changed (llm-pi-ai mounted, routes added/removed).
  ctx.on('llm/adapters-updated', schedule)
}
