/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { CopyButton } from '@/components/ui/CopyButton'

const writeText = jest.fn<Promise<void>, [string]>()

// userEvent.setup() installs its own clipboard stub, so this suite clicks with
// fireEvent to exercise the component's real navigator.clipboard call.
beforeEach(() => {
  jest.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
})

describe('CopyButton', () => {
  it('confirms the copy, then returns to the idle label', async () => {
    // Fake timers from the start: the revert is scheduled inside the click.
    jest.useFakeTimers()
    writeText.mockResolvedValue()
    render(
      <CopyButton
        testId="copy"
        value="ws-1"
        label="Copy id"
        copiedLabel="Id copied"
      />,
    )

    expect(screen.getByTestId('copy')).toHaveTextContent('Copy id')
    fireEvent.click(screen.getByTestId('copy'))
    // Flush the clipboard promise without advancing the clock.
    await act(async () => undefined)
    expect(writeText).toHaveBeenCalledWith('ws-1')
    expect(screen.getByTestId('copy')).toHaveTextContent('Id copied')

    act(() => {
      jest.advanceTimersByTime(2_000)
    })
    expect(screen.getByTestId('copy')).toHaveTextContent('Copy id')
    jest.useRealTimers()
  })

  it('says so instead of pretending, when the clipboard is unavailable', async () => {
    // navigator.clipboard is undefined outside a secure context.
    writeText.mockRejectedValue(new Error('denied'))
    render(<CopyButton testId="copy" value="secret" />)
    fireEvent.click(screen.getByTestId('copy'))
    await waitFor(() =>
      expect(screen.getByTestId('copy')).toHaveTextContent('Press'),
    )
  })
})

describe('CopyButton fallbacks', () => {
  it('falls back to the legacy copy when the async clipboard never settles', async () => {
    // A promise that never resolves is what an unfocused document produces.
    writeText.mockReturnValue(new Promise<void>(() => undefined))
    const execCommand = jest.fn(() => true)
    Object.defineProperty(document, 'execCommand', {
      value: execCommand,
      configurable: true,
    })

    render(<CopyButton testId="copy" value="ws-1" />)
    fireEvent.click(screen.getByTestId('copy'))
    await waitFor(
      () => expect(screen.getByTestId('copy')).toHaveTextContent('Copied'),
      { timeout: 3_000 },
    )
    expect(execCommand).toHaveBeenCalledWith('copy')
  })
})
