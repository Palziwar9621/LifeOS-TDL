import React from 'react';

const FAQ_ITEMS = [
  {
    question: 'Is LifeOS free?',
    answer: <>Yes — LifeOS is free to use during the Beta. Pricing after Beta hasn't been decided; if that changes, it will be announced in the app and on this site first.</>,
  },
  {
    question: 'Do I need an account?',
    answer: <>You can continue as a guest and use LifeOS entirely on your device — tasks, notes, routines and more work offline. Create a free account when you want cloud sync across devices, the AI assistant and account recovery. Guest data can be migrated into your account later.</>,
  },
  {
    question: 'Does LifeOS work offline?',
    answer: <>Yes. Core features — tasks, notes, reminders, routines, calendar, focus — work offline and queue your changes. Cloud sync, the AI assistant and push alarms need an internet connection.</>,
  },
  {
    question: 'How does the AI voice assistant handle my voice?',
    answer: <>Speech is transcribed on your device (or natively on Android). Only the transcribed text — never audio — is sent to the AI service when the assistant is enabled, and recordings are not stored. You can switch the assistant to an offline parser in Settings at any time.</>,
  },
  {
    question: 'Will alarms ring when the app is closed?',
    answer: <>On Android, exact alarms use the system AlarmManager and survive restarts. On Windows, alarms ring while the app runs in the tray. In browsers, optional web-push alarms cover closed-app alerts where supported.</>,
  },
  {
    question: 'Which platforms are supported?',
    answer: <>Web/PWA, an Android app (APK), and Windows installer plus portable builds. All three share the same account and data.</>,
  },
  {
    question: 'Where is my data stored, and how do I delete it?',
    answer: <>Locally on your device and in your own Supabase-backed account. Export everything from Settings → Backup &amp; Export. You can delete your account and all associated data from Settings → Security → Delete Account.</>,
  },
  {
    question: 'What themes are available?',
    answer: <>Light, dark and system modes, plus premium themes: Kage (ink black with a vermilion glow, inspired by our landing page) and Obsidian &amp; Champagne.</>,
  },
] as const;

export function FaqList() {
  return (
    <div className="faq">
      {FAQ_ITEMS.map(({ question, answer }) => (
        <details key={question}>
          <summary>{question}</summary>
          <div className="faq-a">{answer}</div>
        </details>
      ))}
    </div>
  );
}

export function FaqStructuredData() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: FAQ_ITEMS.map(({ question, answer }) => ({
            '@type': 'Question',
            name: question,
            acceptedAnswer: { '@type': 'Answer', text: answer.props.children },
          })),
        }),
      }}
    />
  );
}
