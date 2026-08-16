import { SignUp } from '@clerk/nextjs'
import type { ReactElement } from 'react'

import { AuthFrame } from '@/components/shell/AuthFrame'

const SignUpPage = (): ReactElement => (
  <AuthFrame testId="sign-up-page">
    <SignUp />
  </AuthFrame>
)

export default SignUpPage
