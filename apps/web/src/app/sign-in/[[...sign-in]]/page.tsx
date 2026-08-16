import { SignIn } from '@clerk/nextjs'
import type { ReactElement } from 'react'

import { AuthFrame } from '@/components/shell/AuthFrame'

const SignInPage = (): ReactElement => (
  <AuthFrame testId="sign-in-page">
    <SignIn />
  </AuthFrame>
)

export default SignInPage
