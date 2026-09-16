// LifeOS — top-level app router
import React from 'react';
import { useApp } from './store';
import { SetupScreen, AuthScreen } from './Auth';
import { Shell } from './Shell';
import { Dashboard } from './pages/Dashboard';
import { TodayPage } from './pages/TodayPage';
import { TasksPage } from './pages/TasksPage';
import { CalendarPage } from './pages/CalendarPage';
import { WeeklyPage } from './pages/WeeklyPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { GoalsPage } from './pages/GoalsPage';
import { NotesPage } from './pages/NotesPage';
import { IdeasPage } from './pages/IdeasPage';
import { RememberPage } from './pages/RememberPage';
import { LibraryPage } from './pages/LibraryPage';
import { StatsPage } from './pages/StatsPage';
import { ProductivityPage } from './pages/ProductivityPage';
import { FocusPage } from './pages/FocusPage';
import { RemindersPage } from './pages/RemindersPage';
import { ReviewPage } from './pages/ReviewPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { Spinner } from '../ui/components';
import { setReminderClickHandler, setTaskClickHandler } from '../lib/notifications';
import { useEffect } from 'react';

export function App() {
  const { session, authLoading, configured } = useApp();
  const { navigate } = useApp();

  useEffect(() => {
    setReminderClickHandler(() => navigate('reminders'));
    setTaskClickHandler((t) => navigate('tasks', { view: 'today' }));
  }, [navigate]);

  if (!configured) return <SetupScreen onConfigured={() => window.location.reload()} />;
  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Spinner className="h-8 w-8" /></div>;
  }
  if (!session) return <AuthScreen />;

  return (
    <Shell>
      <PageRouter />
    </Shell>
  );
}

function PageRouter() {
  const { page } = useApp();
  switch (page) {
    case 'home': return <Dashboard />;
    case 'today': return <TodayPage />;
    case 'tasks': return <TasksPage />;
    case 'calendar': return <CalendarPage />;
    case 'weekly': return <WeeklyPage />;
    case 'projects': return <ProjectsPage />;
    case 'goals': return <GoalsPage />;
    case 'notes':
    case 'ideas':
    case 'remember':
    case 'library': return <LibraryPage />;
    case 'stats': return <StatsPage />;
    case 'productivity': return <ProductivityPage />;
    case 'focus': return <FocusPage />;
    case 'reminders': return <RemindersPage />;
    case 'review': return <ReviewPage />;
    case 'search': return <SearchPage />;
    case 'settings': return <SettingsPage />;
    default: return <Placeholder page={page} />;
  }
}

function Placeholder({ page }: { page: string }) {
  return (
    <div className="empty-state">
      <p className="font-semibold">“{page}” is under construction</p>
      <p className="text-sm muted">This section will be built out next.</p>
    </div>
  );
}
