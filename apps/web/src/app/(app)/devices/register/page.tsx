import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { RegisterDeviceForm } from '@/components/devices/RegisterDeviceForm'

export const metadata: Metadata = { title: 'Register a station' }

const RegisterDevicePage = (): ReactElement => (
  <div className="py-10">
    <RegisterDeviceForm testId="register-device" />
  </div>
)

export default RegisterDevicePage
