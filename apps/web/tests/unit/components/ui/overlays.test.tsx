/** @jest-environment jsdom */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { ToastProvider, useToast } from '@/components/ui/Toast'

const DialogHarness = (): ReactElement => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button testId="open" onClick={() => setOpen(true)}>
        Open
      </Button>
      <Dialog
        testId="dlg"
        open={open}
        onOpenChange={setOpen}
        title="Export CSV"
        description="Pick a range"
      >
        <p>body</p>
      </Dialog>
    </>
  )
}

const ToastHarness = (): ReactElement => {
  const { toast } = useToast()
  return (
    <Button
      testId="fire"
      onClick={() => toast({ title: 'Station registered', tone: 'success' })}
    >
      Fire
    </Button>
  )
}

describe('overlays', () => {
  it('Dialog opens with title and closes on Escape', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)
    await user.click(screen.getByTestId('open'))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Export CSV')
    expect(screen.getByTestId('dlg-content')).toHaveTextContent('body')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Toast renders the fired toast', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    )
    await act(async () => {
      await user.click(screen.getByTestId('fire'))
    })
    expect(screen.getByTestId('toast-0')).toHaveTextContent(
      'Station registered',
    )
  })
})
