/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Switch } from '@/components/ui/Switch'

describe('SegmentedControl', () => {
  it('marks the selected option and calls onValueChange', async () => {
    const onChange = jest.fn()
    const user = userEvent.setup()
    render(
      <SegmentedControl
        testId="seg"
        ariaLabel="Range"
        layoutId="seg-test"
        value="24h"
        onValueChange={onChange}
        options={[
          { value: '24h', label: '24 h' },
          { value: '7d', label: '7 d' },
        ]}
      />,
    )
    expect(screen.getByTestId('seg-24h')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(screen.getByTestId('seg-7d'))
    expect(onChange).toHaveBeenCalledWith('7d')
  })
})

describe('Switch', () => {
  it('toggles', async () => {
    const onChange = jest.fn()
    const user = userEvent.setup()
    render(
      <Switch
        testId="sw"
        checked={false}
        onCheckedChange={onChange}
        ariaLabel="Enable"
      />,
    )
    await user.click(screen.getByTestId('sw'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
