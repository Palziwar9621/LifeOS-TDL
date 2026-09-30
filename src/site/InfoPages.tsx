// LifeOS — public info pages: About, Contact, Privacy, Terms, FAQ, 404.
// All copy is checked against verified implementation (see AUDIT-REPORT).
import React from 'react';
import { SiteChrome, useSeo } from './SiteChrome';
import { SITE } from '../lib/site';

/* ------------------------------------------------------------------ */
/* About                                                               */
/* ------------------------------------------------------------------ */
export function AboutPage() {
  useSeo({
    title: 'About LifeOS — a personal productivity system built for real life',
    description:
      'LifeOS is a Beta personal productivity platform by Kratim Krishan Singh: tasks, routines, notes, goals, reminders and AI assistance in one offline-first workspace.',
    path: '/about',
  });
  return (
    <SiteChrome>
      <main className="prose-page">
        <h1>About LifeOS<span className="badge-beta">Beta</span></h1>
        <span className="updated">Built in {SITE.location} · Free during Beta</span>

        <p>
          LifeOS began as a personal effort to organize everyday life and measure productivity.
          Its creator, <strong>{SITE.creator}</strong>, needed one connected place for tasks,
          routines, notes and goals instead of scattered apps — and built LifeOS to be exactly
          that for anyone who wants their life organized.
        </p>

        <h2>The problem it solves</h2>
        <p>
          Most people keep tasks in one app, notes in another, habits on paper and goals in
          their head. LifeOS connects planning, execution and reflection into a single system:
          capture anything the moment it appears, organize it automatically, plan the week,
          focus on what matters, and review what actually got done.
        </p>

        <h2>What LifeOS includes today</h2>
        <ul>
          <li>Tasks with priorities, statuses, subtasks, tags, projects and recurring occurrences</li>
          <li>Natural-language Quick Add and a voice assistant (online AI with offline fallback)</li>
          <li>Calendar views, a weekly planner, schedule blocks and standalone reminders</li>
          <li>Routines with per-weekday alarms that ring even when the app is closed</li>
          <li>Notes with folders, idea capture with photo and voice, and anniversary reminders</li>
          <li>Goals and projects with milestones and automatic progress</li>
          <li>Focus timer, statistics, streaks and daily/weekly reviews</li>
          <li>Offline-first storage with queued sync, JSON/CSV export and four premium themes</li>
        </ul>

        <h2>The mission</h2>
        <p>
          Help individuals spend less time managing scattered responsibilities and more time
          focusing on meaningful goals — through planning, execution, reflection and
          improvement.
        </p>

        <h2>Status</h2>
        <p>
          LifeOS is in <strong>Beta</strong> and currently <strong>free</strong>. It's a young
          product built with care and tested on real schedules, but features and pricing may
          still change. Feedback and bug reports are genuinely welcome —{' '}
          <a href="/contact">contact the creator</a> any time.
        </p>
      </main>
    </SiteChrome>
  );
}

/* ------------------------------------------------------------------ */
/* Contact                                                             */
/* ------------------------------------------------------------------ */
export function ContactPage() {
  useSeo({
    title: 'Contact LifeOS — support, bugs and feedback',
    description:
      'Reach the LifeOS team by email for support, bug reports, feature requests and privacy enquiries. We aim to respond within one business day.',
    path: '/contact',
  });
  return (
    <SiteChrome>
      <main className="prose-page">
        <h1>Contact Us</h1>
        <span className="updated">We aim to respond within one business day</span>

        <p>
          The fastest way to reach LifeOS is email:{' '}
          <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
        </p>

        <h2>What to email about</h2>
        <ul>
          <li><strong>Technical support</strong> — setup, sync, alarms or account trouble</li>
          <li><strong>Bug reports</strong> — tell us the platform (web, Android, Windows) and what happened</li>
          <li><strong>Feature requests</strong> — what would make LifeOS genuinely more useful?</li>
          <li><strong>Privacy enquiries</strong> — data access, deletion status or policy questions</li>
          <li><strong>General enquiries</strong> — anything else</li>
        </ul>

        <h2>Elsewhere</h2>
        <ul>
          <li>GitHub: <a href={SITE.github} rel="noopener noreferrer">{SITE.github}</a></li>
          <li>LinkedIn: <a href={SITE.linkedin} rel="noopener noreferrer">{SITE.linkedin}</a></li>
        </ul>

        <p>
          Please don't send passwords or other sensitive credentials by email — support will
          never ask for them.
        </p>
      </main>
    </SiteChrome>
  );
}

/* ------------------------------------------------------------------ */
/* Privacy Policy                                                      */
/* ------------------------------------------------------------------ */
export function PrivacyPage() {
  useSeo({
    title: 'LifeOS Privacy Policy',
    description:
      'How LifeOS handles your data: local-first storage, Supabase sync, AI voice processing, permissions, retention and deletion.',
    path: '/privacy',
  });
  return (
    <SiteChrome>
      <main className="prose-page">
        <h1>Privacy Policy<span className="badge-beta">Beta</span></h1>
        <span className="updated">Last updated: 29 September 2026 · Applies to the LifeOS web app, PWA, Android and Windows apps</span>

        <p>
          This policy describes what LifeOS actually does with data, based on how the product is
          built. LifeOS is developed by {SITE.creator} ({SITE.location}). Questions or deletion
          requests: <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.
        </p>

        <h2>What we collect and where it lives</h2>
        <ul>
          <li><strong>Account information:</strong> if you create an account, your email address and optional username/profile picture URL are stored in Supabase Authentication and a profiles table.</li>
          <li><strong>Your content:</strong> tasks, subtasks, notes, ideas (including optional photos and voice memos you attach), reminders, remembered items, routines, schedule blocks, goals, projects, focus sessions and app settings. These are stored first on your device (IndexedDB/local storage) and synced to a Supabase Postgres database protected by row-level security, so only your account can read or change your rows.</li>
          <li><strong>Local-only data:</strong> if you use LifeOS as a guest, your content stays on your device and is never uploaded. Clearing browser/app data or uninstalling removes it.</li>
          <li><strong>Alarm bookkeeping:</strong> technical records of which alarms have fired or been dismissed (short-lived, up to ~2 days) to avoid duplicate notifications.</li>
          <li><strong>Push subscriptions:</strong> if you enable background alarms in a browser, your device's push subscription endpoint is stored to deliver alarms.</li>
        </ul>

        <h2>Voice & AI processing</h2>
        <p>
          The voice assistant uses your device's speech recognition to convert speech to text.
          Audio is processed by the platform's recognizer and is <strong>not stored</strong> by
          LifeOS. When the AI mode is enabled, the transcribed text and a small operational
          context (today's date, current page, project/category names and recent task titles)
          are sent to a Groq-hosted language model via a server-side function so it can turn
          your words into tasks and reminders. The assistant can be switched to a fully
          offline parser in Settings at any time. Idea voice memos that you explicitly attach
          are stored as part of your own data.
        </p>

        <h2>Service providers</h2>
        <ul>
          <li><strong>Supabase</strong> — authentication, database and realtime sync (data hosting regions per Supabase project settings).</li>
          <li><strong>Groq, Inc.</strong> — language-model inference for the assistant, only when AI mode is enabled.</li>
          <li><strong>Vercel, Inc.</strong> — static hosting and deployment of the web app.</li>
          <li><strong>Browser/OS push services</strong> — deliver alarm notifications if enabled.</li>
        </ul>

        <h2>Permissions</h2>
        <p>
          LifeOS requests device permissions only when you use the related feature:
          <strong> notifications</strong> (alarms and reminders), <strong>microphone</strong>
          (voice assistant, always opt-in), and on Android <strong>exact alarms</strong> (so
          alarms ring with the app closed). Camera/storage are used only if you attach a photo
          to an idea. You can revoke permissions in your device or browser settings.
        </p>

        <h2>Cookies, analytics and tracking</h2>
        <p>
          LifeOS stores your preferences (theme, assistant settings, session token) in local
          storage — not tracking cookies. No advertising, no third-party analytics, and no
          crash-reporting service is currently integrated. If that changes, this policy will be
          updated and any analytics will require your consent where applicable.
        </p>

        <h2>Retention & deletion</h2>
        <p>
          Your data is retained while your account exists. You can export everything at any
          time (Settings → Backup &amp; Export). Deleting your account (Settings → Security →
          Delete Account) removes your account and its associated data from the production
          database and authentication system. Note that provider backups may retain residual
          copies for a limited period beyond deletion, and we cannot guarantee instant erasure
          from all provider infrastructure; legally required retention may also apply.
        </p>

        <h2>Children's privacy</h2>
        <p>
          LifeOS is intended for users aged 16 and over. We do not knowingly collect data from
          children under 16. If you believe a child under 16 has created an account, contact us
          and it will be removed.
        </p>

        <h2>Your rights & grievance contact</h2>
        <p>
          You can access, correct, export or delete your data through the app or by emailing{' '}
          <a href={`mailto:${SITE.email}`}>{SITE.email}</a> (our grievance contact). LifeOS is
          developed in India; this policy is written to align with India's Digital Personal Data
          Protection (DPDP) framework as it comes into force. Final legal review of this policy
          is pending — no claim of statutory compliance is made beyond the practices described
          here.
        </p>

        <h2>Security</h2>
        <p>
          Data in transit uses TLS. The database enforces row-level security per user. API keys
          for privileged operations stay server-side and are never included in the app. No
          system is perfectly secure — please use a strong, unique password and keep your own
          backups via export.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          Material changes will be announced in the app and on this page with a new "last
          updated" date. Continued use after changes means you accept the updated policy.
        </p>
      </main>
    </SiteChrome>
  );
}

/* ------------------------------------------------------------------ */
/* Terms                                                               */
/* ------------------------------------------------------------------ */
export function TermsPage() {
  useSeo({
    title: 'LifeOS Terms & Conditions',
    description:
      'The terms that apply to your use of LifeOS: Beta status, eligibility, acceptable use, AI features, data, liability and governing law.',
    path: '/terms',
  });
  return (
    <SiteChrome>
      <main className="prose-page">
        <h1>Terms &amp; Conditions<span className="badge-beta">Beta</span></h1>
        <span className="updated">Last updated: 29 September 2026</span>

        <p>
          These terms govern your use of LifeOS, a personal productivity application provided by
          {SITE.creator} ("LifeOS", "we"). By using LifeOS you agree to them. Contact:{' '}
          <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.
        </p>

        <h2>1. Beta status & pricing</h2>
        <p>
          LifeOS is in Beta and is currently free. Features, availability and pricing may change
          at any time during Beta. The service is provided without commitment to continuous
          availability.
        </p>

        <h2>2. Eligibility</h2>
        <p>
          LifeOS is intended for users aged 16 and over. By creating an account you represent
          that you meet this requirement and that any account information you provide is
          accurate.
        </p>

        <h2>3. Accounts & security</h2>
        <p>
          Keep your password confidential; you're responsible for activity under your account.
          You may delete your account at any time from Settings → Security, which removes your
          account and associated data as described in the Privacy Policy.
        </p>

        <h2>4. Acceptable use</h2>
        <ul>
          <li>Don't use LifeOS for unlawful purposes or to store unlawful content.</li>
          <li>Don't attempt to access other users' data, probe or disrupt the service.</li>
          <li>Don't reverse-engineer the service beyond what open-source licenses permit.</li>
        </ul>

        <h2>5. Your content</h2>
        <p>
          You keep ownership of everything you create in LifeOS. You grant us the limited
          technical license needed to store, sync and display your content back to you — nothing
          more. LifeOS's own software, design and branding remain the property of the creator,
          except for components under their own open-source licenses (attributions included in
          the source package).
        </p>

        <h2>6. AI features</h2>
        <p>
          The optional voice assistant uses third-party AI (currently Groq) to interpret your
          commands. AI output may be wrong — check before relying on it, especially for
          time-sensitive items. Destructive voice actions (like deleting a task) are matched by
          title and can occasionally match the wrong item; review the confirmation the assistant
          shows.
        </p>

        <h2>7. Reminders & alarms</h2>
        <p>
          Alarm delivery depends on your device and platform settings (exact-alarm permission on
          Android, tray mode on Windows, browser push support). We can't guarantee that an alarm
          will always fire — don't rely on LifeOS alone for safety-critical timing.
        </p>

        <h2>8. Offline & sync</h2>
        <p>
          LifeOS is offline-first: changes are stored locally and synced when a connection is
          available. Conflicts resolve by newest change. Keep your own export backups (Settings
          → Backup &amp; Export) — especially during Beta.
        </p>

        <h2>9. Third-party services</h2>
        <p>
          LifeOS relies on Supabase (auth/database), Vercel (hosting) and, when AI mode is
          enabled, Groq. Their availability and terms apply to the parts of the service they
          provide.
        </p>

        <h2>10. Disclaimers & liability</h2>
        <p>
          LifeOS is provided "as is" during Beta, without warranties of any kind to the maximum
          extent permitted by law. To the extent legally permissible, the creator's total
          liability arising from your use of LifeOS is limited to the amount you paid (which is
          currently zero). Nothing in these terms limits liability that cannot be limited under
          applicable law, including statutory consumer rights.
        </p>

        <h2>11. Suspension & termination</h2>
        <p>
          We may suspend or terminate accounts that violate these terms. You may stop using
          LifeOS and delete your account at any time.
        </p>

        <h2>12. Changes, governing law & contact</h2>
        <p>
          These terms may change as the product evolves; significant changes will be announced
          in the app. The laws of India apply, and the courts of competent jurisdiction in India
          (Uttar Pradesh) shall have authority over disputes. These terms are a plain-language
          summary of intent — they have not yet been reviewed by qualified legal counsel, and
          that review is planned before general availability.
        </p>
      </main>
    </SiteChrome>
  );
}

/* ------------------------------------------------------------------ */
/* 404                                                                 */
/* ------------------------------------------------------------------ */
export function NotFoundPage() {
  useSeo({ title: 'Page not found — LifeOS', description: 'That page does not exist.', path: '/404' });
  return (
    <SiteChrome>
      <main className="prose-page" style={{ textAlign: 'center' }}>
        <h1>404</h1>
        <p style={{ marginBottom: 28 }}>That page doesn't exist or has moved.</p>
        <div className="hero-ctas" style={{ justifyContent: 'center' }}>
          <a className="site-cta" href="/">Go home</a>
          <a className="site-cta secondary" href={SITE.appPath}>Open LifeOS</a>
        </div>
      </main>
    </SiteChrome>
  );
}
