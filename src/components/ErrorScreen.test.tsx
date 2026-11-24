import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorScreen } from './ErrorScreen'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ErrorScreen', () => {
  it('hides exception details in production', () => {
    vi.stubEnv('DEV', false)
    const error = new Error('private-runtime-detail')
    error.stack = 'Error: private-stack-detail'

    const html = renderToStaticMarkup(<ErrorScreen error={error} />)

    expect(html).toContain('Something went wrong')
    expect(html).not.toContain('private-runtime-detail')
    expect(html).not.toContain('private-stack-detail')
    expect(html).not.toContain('Show stack trace')
  })

  it('shows diagnostic details in development', () => {
    vi.stubEnv('DEV', true)
    const error = new Error('local-diagnostic')
    error.stack = 'Error: local-stack'

    const html = renderToStaticMarkup(<ErrorScreen error={error} />)

    expect(html).toContain('local-diagnostic')
    expect(html).toContain('local-stack')
    expect(html).toContain('Show stack trace')
  })
})
