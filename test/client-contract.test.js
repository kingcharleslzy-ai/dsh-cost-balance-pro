import assert from 'node:assert/strict'
import test from 'node:test'

test('client entry returns an applicable plugin with its timer dependency', async () => {
  let registration
  globalThis.window = {
    __ModuleLoader__: {
      load(entry) {
        registration = entry
      },
    },
  }

  try {
    await import(`../lib/client.js?test=${Date.now()}`)

    assert.equal(registration?.id, 'dsh-cost-balance-pro')
    const plugin = registration.factory((id) => {
      assert.equal(id, 'react')
      return {}
    })

    assert.equal(typeof plugin?.apply, 'function')
    assert.deepEqual(plugin.inject, ['timer'])
  } finally {
    delete globalThis.window
  }
})
