// Smoke test for buildFillPatch — run with: node test/build-fill-patch.smoke.mjs
import { buildFillPatch } from '../host/lib/index.js'

let failures = 0
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) {
    console.log(`[ok] ${name}`)
  } else {
    failures += 1
    console.error(`[FAIL] ${name}\n  actual:   ${a}\n  expected: ${b}`)
  }
}

const DEFAULT = { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }
const model = (id, extra = {}) => ({ id, name: id, contextWindow: 1000000, maxTokens: 100000, ...extra })
const fillAll = async () => true
const fillNone = async () => false

// 1) Models whose probe says "no reasoning metadata" get filled, in a rebuilt array.
{
  const section = { providers: { 'poke-api': { api: 'openai-responses', models: [model('gpt-5.5'), model('glm-5.3')] } } }
  const user = { providers: { 'poke-api': { apiKeyEnv: 'KEY', models: [model('gpt-5.5'), model('glm-5.3')] } } }
  const result = await buildFillPatch(section, user, fillAll)
  check('filled count', result.filled, 2)
  check('patch keeps every original entry field and adds the map',
    result.patch.providers['poke-api'].models,
    [{ ...model('gpt-5.5'), reasoningEfforts: DEFAULT }, { ...model('glm-5.3'), reasoningEfforts: DEFAULT }])
  check('patch touches only the models array (route-level keys preserved by merge)',
    Object.keys(result.patch.providers['poke-api']), ['models'])
}

// 2) Probe says the model already reports reasoning → untouched.
{
  const section = { providers: { r: { api: 'openai-responses', models: [model('m')] } } }
  const user = { providers: { r: { models: [model('m')] } } }
  check('probe false → no patch', await buildFillPatch(section, user, fillNone), undefined)
}

// 3) A declared map (or explicit false) is a declaration — probe is not even consulted.
{
  let probed = false
  const probe = async () => { probed = true; return true }
  const declared = model('m1', { reasoningEfforts: { off: null, high: 'ultra' } })
  const disabled = model('m2', { reasoningEfforts: false })
  const section = { providers: { r: { api: 'openai-completions', models: [declared, disabled] } } }
  const user = { providers: { r: { models: [declared, disabled] } } }
  check('declared/false skipped', await buildFillPatch(section, user, probe), undefined)
  check('probe never consulted for declared entries', probed, false)
}

// 4) A route that exists only in the composition base is skipped (no sparse-array clobbering).
{
  const section = { providers: { baseonly: { api: 'openai-responses', models: [model('m')] } } }
  const user = { providers: { other: { models: [] } } }
  check('base-only route skipped', await buildFillPatch(section, user, fillAll), undefined)
}

// 5) Non-bridged protocols are skipped.
{
  const section = { providers: { g: { api: 'google-generative-ai', models: [model('m')] } } }
  const user = { providers: { g: { models: [model('m')] } } }
  check('google-generative-ai skipped', await buildFillPatch(section, user, fillAll), undefined)
}

// 6) anthropic-messages IS bridged.
{
  const section = { providers: { a: { api: 'anthropic-messages', models: [model('claude')] } } }
  const user = { providers: { a: { models: [model('claude')] } } }
  check('anthropic-messages filled', (await buildFillPatch(section, user, fillAll)).filled, 1)
}

// 7) Missing user layer entirely → nothing to do.
{
  const section = { providers: { r: { api: 'openai-responses', models: [model('m')] } } }
  check('no user layer → no patch', await buildFillPatch(section, undefined, fillAll), undefined)
}

// 8) Malformed input stays total (no throw).
{
  check('undefined section', await buildFillPatch(undefined, undefined, fillAll), undefined)
  check('null section', await buildFillPatch(null, null, fillAll), undefined)
  check('non-object provider entry', await buildFillPatch({ providers: { r: 5 } }, { providers: { r: 5 } }, fillAll), undefined)
  check('missing probe', await buildFillPatch({ providers: {} }, { providers: {} }, undefined), undefined)
}

// 9) api missing on the resolved profile → skipped (cannot verify the protocol).
{
  const section = { providers: { r: { models: [model('m')] } } }
  const user = { providers: { r: { models: [model('m')] } } }
  check('api-less route skipped', await buildFillPatch(section, user, fillAll), undefined)
}

// 10) A probe rejection skips that one model but not the rest of the pass.
{
  const section = { providers: { r: { api: 'openai-responses', models: [model('a'), model('b')] } } }
  const user = { providers: { r: { models: [model('a'), model('b')] } } }
  const probe = async (_p, m) => {
    if (m === 'a') throw new Error('route mid-re-registration')
    return true
  }
  const result = await buildFillPatch(section, user, probe)
  check('rejected probe skips one model, fills the other',
    result.patch.providers.r.models.map(m => [m.id, m.reasoningEfforts !== undefined]),
    [['a', false], ['b', true]])
  check('filled counts only the filled one', result.filled, 1)
}

// 11) Mixed: one declared, one catalog-capable (probe false), one missing.
{
  const declared = model('m1', { reasoningEfforts: { high: 'high' } })
  const section = { providers: { r: { api: 'openai-responses', models: [declared, model('m2'), model('m3')] } } }
  const user = { providers: { r: { models: [declared, model('m2'), model('m3')] } } }
  const probe = async (_p, m) => m === 'm3'
  const result = await buildFillPatch(section, user, probe)
  check('only the missing, probe-confirmed entry is filled',
    result.patch.providers.r.models.map(m => [m.id, m.reasoningEfforts !== undefined]),
    [['m1', true], ['m2', false], ['m3', true]])
}

// 12) Two routes, only one bridged.
{
  const section = {
    providers: {
      ok: { api: 'openai-responses', models: [model('m')] },
      google: { api: 'google-generative-ai', models: [model('m')] },
    },
  }
  const user = {
    providers: {
      ok: { models: [model('m')] },
      google: { models: [model('m')] },
    },
  }
  const result = await buildFillPatch(section, user, fillAll)
  check('patch contains only the bridged route', Object.keys(result.patch.providers), ['ok'])
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
