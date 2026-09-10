import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({
  disconnectLinear: vi.fn(),
  getLinearIntegration: vi.fn(),
  selectLinearTeam: vi.fn(),
}))

import { disconnectLinear, getLinearIntegration, selectLinearTeam } from '../api'
import { LinearIntegrationSettings } from './LinearIntegrationSettings'

const props = { apiBase: 'https://api.crrt.test', accessToken: 'session', projectKey: 'shop' }
const connected = {
  provider: 'linear' as const,
  connected: true,
  workspace: 'Acme',
  selectedDestinationId: 'team-web',
  destinations: [
    { id: 'team-web', name: 'WEB · Website' },
    { id: 'team-product', name: 'PROD · Product' },
  ],
}

beforeEach(() => {
  vi.mocked(getLinearIntegration).mockReset()
  vi.mocked(selectLinearTeam).mockReset()
  vi.mocked(disconnectLinear).mockReset()
})

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('<LinearIntegrationSettings />', () => {
  it('loads a connection and changes its destination team', async () => {
    vi.mocked(getLinearIntegration).mockResolvedValue(connected)
    vi.mocked(selectLinearTeam).mockResolvedValue({ ...connected, selectedDestinationId: 'team-product' })

    render(<LinearIntegrationSettings {...props} />)
    expect(await screen.findByText('Acme')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Linear team'), { target: { value: 'team-product' } })

    await waitFor(() => expect(selectLinearTeam).toHaveBeenCalledWith(
      props.apiBase, props.accessToken, props.projectKey, 'team-product',
    ))
    expect(screen.getByLabelText('Linear team')).toHaveValue('team-product')
  })

  it('renders an empty selected team safely', async () => {
    vi.mocked(getLinearIntegration).mockResolvedValue({ ...connected, selectedDestinationId: null })
    render(<LinearIntegrationSettings {...props} />)
    expect(await screen.findByLabelText('Linear team')).toHaveValue('team-web')
  })

  it('accepts only an origin-bound OAuth result from its popup', async () => {
    vi.mocked(getLinearIntegration)
      .mockResolvedValueOnce({ provider: 'linear', connected: false, destinations: [] })
      .mockResolvedValueOnce({
        provider: 'linear', connected: false, destinations: [],
        authorizeUrl: 'https://linear.app/oauth/authorize?state=signed',
      })
      .mockResolvedValueOnce(connected)
    const popup = { closed: false } as Window
    vi.spyOn(window, 'open').mockReturnValue(popup)

    render(<LinearIntegrationSettings {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Linear' }))
    await waitFor(() => expect(window.open).toHaveBeenCalledWith(
      'https://linear.app/oauth/authorize?state=signed', 'crrt-linear-connect',
    ))

    act(() => window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://attacker.test', source: popup,
      data: { type: 'crrt:linear-connect', ok: true, projectKey: 'shop' },
    })))
    expect(screen.queryByText('Acme')).not.toBeInTheDocument()

    act(() => window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://api.crrt.test', source: popup,
      data: { type: 'crrt:linear-connect', ok: true, projectKey: 'shop' },
    })))
    expect(await screen.findByText('Acme')).toBeInTheDocument()
  })

  it('shows safe load, selection, and disconnect failures', async () => {
    vi.mocked(getLinearIntegration).mockRejectedValueOnce(new Error('secret'))
    const view = render(<LinearIntegrationSettings {...props} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
    view.unmount()

    vi.mocked(getLinearIntegration).mockResolvedValue(connected)
    vi.mocked(selectLinearTeam).mockRejectedValueOnce(new Error('secret'))
    vi.mocked(disconnectLinear).mockRejectedValueOnce(new Error('secret'))
    render(<LinearIntegrationSettings {...props} />)
    await screen.findByText('Acme')
    fireEvent.change(screen.getByLabelText('Linear team'), { target: { value: 'team-product' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update the Linear team.')
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not disconnect Linear.')
  })

  it('disconnects and reloads a connected workspace', async () => {
    vi.mocked(getLinearIntegration)
      .mockResolvedValueOnce(connected)
      .mockResolvedValueOnce({ provider: 'linear', connected: false, destinations: [] })
    vi.mocked(disconnectLinear).mockResolvedValue()
    render(<LinearIntegrationSettings {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByRole('button', { name: 'Connect Linear' })).toBeInTheDocument()
  })

  it('offers reconnection when the saved authorization lacks write access', async () => {
    vi.mocked(getLinearIntegration)
      .mockResolvedValueOnce({ ...connected, reauthorizationRequired: true })
      .mockResolvedValueOnce({ ...connected, reauthorizationRequired: true, authorizeUrl: 'https://linear.app/oauth/authorize' })
    const popup = { closed: false } as Window
    vi.spyOn(window, 'open').mockReturnValue(popup)
    render(<LinearIntegrationSettings {...props} />)
    expect(await screen.findByRole('status')).toHaveTextContent('Reconnect Linear')
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('https://linear.app/oauth/authorize', 'crrt-linear-connect'))
  })

  it('rejects invalid authorization URLs and blocked popups', async () => {
    vi.mocked(getLinearIntegration)
      .mockResolvedValueOnce({ provider: 'linear', connected: false, destinations: [] })
      .mockResolvedValueOnce({ provider: 'linear', connected: false, destinations: [], authorizeUrl: 'https://attacker.test/oauth' })
      .mockResolvedValueOnce({ provider: 'linear', connected: false, destinations: [], authorizeUrl: 'https://linear.app/oauth/authorize' })
    vi.spyOn(window, 'open').mockReturnValue(null)
    render(<LinearIntegrationSettings {...props} />)
    const connect = await screen.findByRole('button', { name: 'Connect Linear' })
    fireEvent.click(connect)
    expect(await screen.findByRole('alert')).toHaveTextContent('Allow pop-ups')
    fireEvent.click(connect)
    expect(await screen.findByRole('alert')).toHaveTextContent('Allow pop-ups')
  })

  it('ignores unrelated messages, reports OAuth denial, and notices a closed popup', async () => {
    vi.useFakeTimers()
    vi.mocked(getLinearIntegration)
      .mockResolvedValueOnce({ provider: 'linear', connected: false, destinations: [] })
      .mockResolvedValue({ provider: 'linear', connected: false, destinations: [], authorizeUrl: 'https://linear.app/oauth/authorize' })
    const popup = { closed: false } as Window
    vi.spyOn(window, 'open').mockReturnValue(popup)
    render(<LinearIntegrationSettings {...props} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Connect Linear' }))
    await act(async () => {})
    for (const data of [
      { type: 'other', ok: false, projectKey: 'shop' },
      { type: 'crrt:linear-connect', ok: false, projectKey: 'other' },
    ]) act(() => window.dispatchEvent(new MessageEvent('message', { origin: props.apiBase, source: popup, data })))
    act(() => window.dispatchEvent(new MessageEvent('message', { origin: props.apiBase, source: window, data: { type: 'crrt:linear-connect', ok: false, projectKey: 'shop' } })))
    act(() => window.dispatchEvent(new MessageEvent('message', { origin: props.apiBase, source: popup, data: { type: 'crrt:linear-connect', ok: false, projectKey: 'shop' } })))
    expect(screen.getByRole('alert')).toHaveTextContent('authorization could not be completed')

    fireEvent.click(screen.getByRole('button', { name: 'Connect Linear' }))
    await act(async () => {})
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled()
    ;(popup as { closed: boolean }).closed = true
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(screen.getByRole('button', { name: 'Connect Linear' })).toBeEnabled()
  })
})
