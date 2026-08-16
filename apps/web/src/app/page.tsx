import { redirect } from 'next/navigation'

/** `/` is not a landing page (spec non-goal): send everyone to the dashboard; proxy handles sign-in. */
const Home = (): never => redirect('/dashboard')

export default Home
