import Link from 'next/link'
import type { ReactElement, ReactNode } from 'react'

const Section = ({
  title,
  children,
}: {
  title: string
  children: ReactNode
}): ReactElement => (
  <section className="flex flex-col gap-2">
    <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
    <div className="text-slate flex flex-col gap-2 text-sm leading-6">
      {children}
    </div>
  </section>
)

/** Privacy policy (MRP-41). Wording mirrors the data-minimisation review in docs/privacy-data-minimisation.md. */
export const PrivacyPolicy = ({ testId }: { testId: string }): ReactElement => (
  <article data-testid={testId} className="flex flex-col gap-8">
    <header className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy policy</h1>
      <p className="text-slate text-sm">
        Weather Station shows you the readings from your own station and, if you
        ask for it, sends them to Telegram. We collect only what that needs.
        Last updated 15 August 2026.
      </p>
    </header>

    <Section title="What we collect">
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <b className="text-ink">Sensor readings</b> — temperature, humidity,
          pressure, wind and rain values with a timestamp, tied to a station id
          (not to a person).
        </li>
        <li>
          <b className="text-ink">Your sign-in identity</b> — the account id
          from Clerk, our sign-in provider. Your email address is held by Clerk;
          we do not copy it.
        </li>
        <li>
          <b className="text-ink">Your Telegram user id</b> — only if you link
          your Telegram account or register a station through the bot.
        </li>
        <li>
          <b className="text-ink">Your choices</b> — which stations you can see,
          the roles you grant to others, alert times and days, an optional
          station nickname and address you enter.
        </li>
      </ul>
    </Section>

    <Section title="Why we collect it">
      <p>
        To show your station&apos;s current conditions and history, to let you
        export your own data, to send the alerts you schedule to Telegram, and
        to keep every station&apos;s data private to the people its owner has
        shared it with.
      </p>
    </Section>

    <Section title="How long we keep it">
      <p>
        Full-resolution readings are kept for 12 months; after that we keep only
        daily summaries (minimum, average, maximum) indefinitely. Account,
        station links, alerts and Telegram links are kept until you delete them
        or your account.
      </p>
    </Section>

    <Section title="Who can see it">
      <p>
        Nobody outside the people you share a station with. Station data is
        never public. Our providers process data on our behalf: Clerk (sign-in),
        Supabase (database and bot hosting), Vercel (web hosting), Telegram
        (message delivery).
      </p>
    </Section>

    <Section title="Your rights">
      <p>
        You can export your readings at any time (Dashboard → Export CSV) and
        delete your account from{' '}
        <Link
          href="/settings"
          className="text-ink underline underline-offset-2"
        >
          Settings
        </Link>
        . Deletion removes your sign-in account (held by Clerk), station links,
        alerts and Telegram link immediately; readings stay with the station
        (they are not linked to you once your account is gone) and the station
        becomes claimable again. If you only use the Telegram bot, email us and
        we will remove your Telegram id and alerts.
      </p>
    </Section>

    <Section title="Contact">
      <p>
        Questions or requests:{' '}
        <a
          href="mailto:privacy@example.com"
          className="text-ink underline underline-offset-2"
        >
          privacy@example.com
        </a>
        .
      </p>
    </Section>
  </article>
)
