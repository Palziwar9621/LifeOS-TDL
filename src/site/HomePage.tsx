// LifeOS — public homepage. Native animated night scene + crawlable LifeOS content.
import React from 'react';
import { SiteChrome, useSeo } from './SiteChrome';
import { HeroScene } from './HeroScene';
import { SITE } from '../lib/site';

export function HomePage() {
  useSeo({
    title: 'LifeOS — AI-Powered Personal Productivity & Task Manager',
    description:
      'Organize tasks, plan your day, manage reminders, build routines and track productivity with LifeOS, your all-in-one personal productivity workspace.',
    path: '/home',
  });

  return (
    <SiteChrome>
      {/* JSON-LD: verified properties only (no ratings, no fabricated offers) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'LifeOS',
            applicationCategory: 'ProductivityApplication',
            operatingSystem: 'Web, Android, Windows',
            description:
              'All-in-one personal productivity app: tasks, routines, notes, goals, reminders, planning and an AI voice assistant. Offline-first with cloud sync.',
            url: SITE.url,
            author: { '@type': 'Person', name: SITE.creator },
            isAccessibleForFree: true,
          }),
        }}
      />

      <main>
        {/* ---------------- HERO ---------------- */}
        <section className="hero" aria-label="Introduction">
          <div className="hero-scene" aria-hidden={false}>
            <HeroScene />
          </div>
          <div className="hero-overlay">
            <div>
              <h1>One calm place for your whole life</h1>
              <p>
                LifeOS brings your tasks, routines, notes, goals and reminders into a single
                offline-first workspace — with an AI voice assistant that plans your day while
                you stay in flow. Free during Beta.
              </p>
            </div>
            <div className="hero-ctas">
              <a className="site-cta" href={SITE.appPath}>Open LifeOS</a>
              <a className="site-cta secondary" href="#features">Explore features</a>
            </div>
          </div>
        </section>

        {/* ---------------- PROBLEM ---------------- */}
        <Section kicker="The problem" title="Scattered tools scatter your attention">
          <p className="lede">
            Tasks live in one app, notes in another, routines on paper, goals in a spreadsheet and
            reminders in your head. Switching between them costs focus — and things slip. LifeOS
            connects planning, execution and reflection so nothing has to be remembered twice.
          </p>
        </Section>

        {/* ---------------- FEATURES ---------------- */}
        <Section kicker="Features" title="Everything you plan, in one connected system" id="features">
          <p className="lede">
            Every feature below works today in the app — they share one data model, so a task
            added by voice appears instantly in Today, Calendar and your statistics.
          </p>
          <div className="grid-cards">
            <Feature emoji="✅" title="Tasks that stay organized">
              Priorities, statuses, due dates, subtasks, tags, projects and drag-to-reorder — with
              bulk actions and powerful filters for busy days.
            </Feature>
            <Feature emoji="💬" title="Quick Add with natural language">
              Type “gym tomorrow 6pm !high #fitness” and LifeOS parses the date, time, priority
              and tags for you — no forms required.
            </Feature>
            <Feature emoji="🎙️" title="AI voice assistant">
              Say “dinner with Sam tomorrow 9pm” and it becomes a timed task with an alarm. The
              assistant runs on Groq, with an offline parser as fallback when you're disconnected.
            </Feature>
            <Feature emoji="📅" title="Calendar & weekly planner">
              Day, week and month views, schedule blocks for repeating commitments, and a weekly
              planner that turns intentions into allocated time.
            </Feature>
            <Feature emoji="🔁" title="Routines & alarms">
              Weekday habits with time-of-day and colors. Alarms ring even when the app is closed
              on Android and Windows — and across devices when you dismiss them.
            </Feature>
            <Feature emoji="⏰" title="Reminders & anniversaries">
              Standalone reminders with snooze and importance flags, plus yearly and monthly
              anniversaries in Remember.
            </Feature>
            <Feature emoji="📝" title="Notes, ideas & Remember">
              Folders and pinning for notes; idea capture with photos and voice memos that convert
              into projects when they're ready.
            </Feature>
            <Feature emoji="🎯" title="Goals & projects">
              Milestones, linked tasks and automatic progress for long-term goals and active
              projects.
            </Feature>
            <Feature emoji="⏳" title="Focus timer & review">
              Pomodoro-style focus sessions feed real statistics, streaks and a daily/weekly
              review that closes the loop.
            </Feature>
            <Feature emoji="📶" title="Offline-first">
              Create, edit and complete without a network. Changes queue locally and sync when
              you reconnect — the sync badge always tells the truth.
            </Feature>
            <Feature emoji="🌙" title="Kage theme & dark mode">
              The Kage theme — ink-black surfaces with a breathing vermilion glow and drifting
              embers — plus Obsidian &amp; Champagne, and light, dark and system modes.
            </Feature>
            <Feature emoji="📲" title="Cross-platform">
              Installable PWA, Android app with native alarms, and a Windows desktop app that
              lives in your tray.
            </Feature>
          </div>
        </Section>

        {/* ---------------- HOW IT WORKS ---------------- */}
        <Section kicker="How it works" title="Capture, organize, plan, focus, review">
          <div className="steps">
            <Step n="1" t="Capture" d="Dump tasks, ideas and reminders the moment they appear — typed or spoken." />
            <Step n="2" t="Organize" d="Tag, categorize and link items to projects and goals automatically." />
            <Step n="3" t="Plan" d="Allocate the week in the planner and let Today surface what matters now." />
            <Step n="4" t="Focus" d="Run focus sessions against a single task and keep alarms in charge of time." />
            <Step n="5" t="Review" d="Check streaks, statistics and a daily review — then improve tomorrow." />
          </div>
        </Section>

        {/* ---------------- PRIVACY ---------------- */}
        <Section kicker="Privacy & control" title="Your data stays yours">
          <p className="lede">
            LifeOS stores your data locally on your device first, then syncs it through your own
            Supabase account with row-level security — only you can read your rows. Voice
            commands are processed only when the assistant is on; recordings are never stored.
            You can export everything as JSON or CSV at any time, and delete your account and its
            data from Settings → Security. LifeOS is still in Beta: treat it as powerful but
            young, and keep your own backups via export.
          </p>
        </Section>

        {/* ---------------- PLATFORMS ---------------- */}
        <Section kicker="Platforms" title="Use it where you already are">
          <div className="grid-cards">
            <Feature emoji="🌐" title="Web & PWA">
              Works in Chrome, Edge and Safari. Install it to your home screen for a full-screen,
              offline-capable app with push alarms.
            </Feature>
            <Feature emoji="🤖" title="Android app">
              Native exact alarms, boot persistence, full-screen alarm overlay and background
              voice listening. Download the APK from the download page.
            </Feature>
            <Feature emoji="🪟" title="Windows app">
              Installer and portable versions with tray mode and native timers. Download from the
              download page or GitHub Releases.
            </Feature>
          </div>
          <p className="lede" style={{ marginTop: 22 }}>
            <a href="/download.html">See download options →</a>
          </p>
        </Section>

        {/* ---------------- FAQ ---------------- */}
        <Section kicker="FAQ" title="Common questions" id="faq">
          <div className="faq">
            <Faq q="Is LifeOS free?">
              Yes — LifeOS is free to use during the Beta. Pricing after Beta hasn't been
              decided; if that changes, it will be announced in the app and on this site first.
            </Faq>
            <Faq q="Do I need an account?">
              You can continue as a guest and use LifeOS entirely on your device — tasks, notes,
              routines and more work offline. Create a free account when you want cloud sync
              across devices, the AI assistant and account recovery. Guest data can be migrated
              into your account later.
            </Faq>
            <Faq q="Does LifeOS work offline?">
              Yes. Core features — tasks, notes, reminders, routines, calendar, focus — work
              offline and queue your changes. Cloud sync, the AI assistant and push alarms need
              an internet connection.
            </Faq>
            <Faq q="How does the AI voice assistant handle my voice?">
              Speech is transcribed on your device (or natively on Android). Only the transcribed
              text — never audio — is sent to the AI service when the assistant is enabled, and
              recordings are not stored. You can switch the assistant to an offline parser in
              Settings at any time.
            </Faq>
            <Faq q="Will alarms ring when the app is closed?">
              On Android, exact alarms use the system AlarmManager and survive restarts. On
              Windows, alarms ring while the app runs in the tray. In browsers, optional web-push
              alarms cover closed-app alerts where supported.
            </Faq>
            <Faq q="Which platforms are supported?">
              Web/PWA, an Android app (APK), and Windows installer plus portable builds. All
              three share the same account and data.
            </Faq>
            <Faq q="Where is my data stored, and how do I delete it?">
              Locally on your device and in your own Supabase-backed account. Export everything
              from Settings → Backup &amp; Export. You can delete your account and all associated
              data from Settings → Security → Delete Account.
            </Faq>
            <Faq q="What themes are available?">
              Light, dark and system modes, plus premium themes: Kage (ink black with a
              vermilion glow, inspired by our landing page) and Obsidian &amp; Champagne.
            </Faq>
          </div>
        </Section>

        {/* ---------------- FINAL CTA ---------------- */}
        <Section kicker="Get started" title="Try LifeOS today — free during Beta">
          <p className="lede">
            Open the app in your browser, install it as a PWA, or download the Android or Windows
            build. No credit card, no setup wizard — just a calmer, more organized life.
          </p>
          <div className="hero-ctas">
            <a className="site-cta" href={SITE.appPath}>Open LifeOS</a>
            <a className="site-cta secondary" href="/download.html">Download for Android / Windows</a>
          </div>
        </Section>
      </main>
    </SiteChrome>
  );
}

function Section(props: { kicker: string; title: string; id?: string; children: React.ReactNode }) {
  return (
    <section className="site-section" id={props.id}>
      <div className="wrap">
        <span className="kicker">{props.kicker}</span>
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </section>
  );
}

function Feature(props: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <div className="card-s">
      <span className="emoji" aria-hidden="true">{props.emoji}</span>
      <h3>{props.title}</h3>
      <p>{props.children}</p>
    </div>
  );
}

function Step(props: { n: string; t: string; d: string }) {
  return (
    <div className="step">
      <b>{props.n}. {props.t}</b>
      <span>{props.d}</span>
    </div>
  );
}

function Faq(props: { q: string; children: React.ReactNode }) {
  return (
    <details>
      <summary>{props.q}</summary>
      <div className="faq-a">{props.children}</div>
    </details>
  );
}
