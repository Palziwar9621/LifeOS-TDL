// LifeOS — lightweight i18n. No runtime dependency: a dictionary per language
// and a React hook. Missing keys fall back to English; missing languages fall
// back to English entirely — the app is always fully usable.
//
// Supported: English, Hindi, Chinese (Simplified), Japanese, Spanish, French,
// German, Portuguese (Brazil), Arabic, Russian.
//
// Usage:
//   const { t, lang, setLang, dir } = useI18n();
//   t('nav.today')             → 'आज' (hi)
//   t('tasks.pending', { n:3 })→ '3 pending'
import { createContext, useContext } from 'react';

export type Lang =
  | 'en' | 'hi' | 'zh' | 'ja' | 'es'
  | 'fr' | 'de' | 'pt' | 'ar' | 'ru';

export const LANGUAGES: { code: Lang; label: string; english: string }[] = [
  { code: 'en', label: 'English',    english: 'English' },
  { code: 'hi', label: 'हिन्दी',      english: 'Hindi' },
  { code: 'zh', label: '中文',        english: 'Chinese (Simplified)' },
  { code: 'ja', label: '日本語',      english: 'Japanese' },
  { code: 'es', label: 'Español',    english: 'Spanish' },
  { code: 'fr', label: 'Français',   english: 'French' },
  { code: 'de', label: 'Deutsch',    english: 'German' },
  { code: 'pt', label: 'Português',  english: 'Portuguese (Brazil)' },
  { code: 'ar', label: 'العربية',    english: 'Arabic' },
  { code: 'ru', label: 'Русский',    english: 'Russian' },
];

const RTL: Lang[] = ['ar'];

// en is the source of truth — every other dictionary may be partial.
const en = {
  // Nav / shell
  'nav.home': 'Home', 'nav.today': 'Today', 'nav.tasks': 'Tasks',
  'nav.calendar': 'Calendar', 'nav.productivity': 'Productivity',
  'nav.projects': 'Projects', 'nav.goals': 'Goals', 'nav.library': 'Library',
  'nav.stats': 'Insights', 'nav.focus': 'Focus', 'nav.settings': 'Settings',
  'nav.more': 'More', 'nav.allSections': 'All sections',
  'nav.notes': 'Notes', 'nav.ideas': 'Ideas', 'nav.reminders': 'Reminders',
  'nav.review': 'Review', 'nav.search': 'Search',

  // Auth
  'auth.welcome': 'Welcome back', 'auth.welcomeSub': 'Sign in to your LifeOS.',
  'auth.email': 'Email', 'auth.password': 'Password',
  'auth.signIn': 'Sign in', 'auth.createAccount': 'Create an account',
  'auth.forgot': 'Forgot password?', 'auth.guest': 'Continue as Guest',
  'auth.guestNote': "Guest mode works offline on this device only. Data isn't synced or backed up — clearing browser/app data or uninstalling removes it. You can create an account later and your guest data will be migrated.",
  'auth.tagline': 'your life, organized',
  'auth.signOut': 'Sign out', 'auth.signOutConfirm': 'Sign out?',
  'auth.signOutBody': "Your data stays synced to your account and this device's offline cache is cleared.",

  // Quick add
  'qa.placeholder': 'Add a task… try "gym tomorrow 6pm !high"',
  'qa.add': 'Add', 'qa.cancel': 'Cancel', 'qa.more': 'More options',
  'qa.title': 'Quick Add',

  // Common
  'common.save': 'Save', 'common.delete': 'Delete', 'common.edit': 'Edit',
  'common.close': 'Close', 'common.confirm': 'Confirm', 'common.done': 'Done',
  'common.today': 'Today', 'common.tomorrow': 'Tomorrow',
  'common.yesterday': 'Yesterday', 'common.overdue': 'Overdue',
  'common.completed': 'Completed', 'common.pending': 'Pending',
  'common.all': 'All', 'common.high': 'High', 'common.medium': 'Medium',
  'common.low': 'Low', 'common.urgent': 'Urgent',
  'common.search': 'Search', 'common.empty': 'Nothing here yet',
  'common.loading': 'Loading…', 'common.you': 'You',
  'common.synced': 'Synced', 'common.offline': 'Offline — tap to retry',
  'common.changesPending': 'changes pending',

  // Today / dashboard
  'today.greetingMorning': 'Good morning', 'today.greetingAfternoon': 'Good afternoon',
  'today.greetingEvening': 'Good evening',
  'today.dueToday': 'Due today', 'today.noTasks': 'Nothing due today — enjoy the calm.',
  'today.upcoming': 'Upcoming', 'today.suggested': 'Suggested',

  // Tasks
  'tasks.addTask': 'Add task', 'tasks.newTask': 'New task',
  'tasks.title': 'Title', 'tasks.notes': 'Notes', 'tasks.dueDate': 'Due date',
  'tasks.dueTime': 'Due time', 'tasks.priority': 'Priority',
  'tasks.project': 'Project', 'tasks.reminder': 'Reminder',
  'tasks.subtasks': 'Subtasks', 'tasks.deleteConfirm': 'Delete this task?',
  'tasks.complete': 'Mark completed', 'tasks.reopen': 'Reopen',
  'tasks.filters': 'Filters', 'tasks.sort': 'Sort',

  // Settings sections
  'settings.appearance': 'Appearance', 'settings.premiumTheme': 'Premium theme',
  'settings.mode': 'Mode', 'settings.modeDark': 'Dark', 'settings.modeLight': 'Light',
  'settings.modeSystem': 'System', 'settings.language': 'Language',
  'settings.security': 'Security', 'settings.account': 'Account',
  'settings.data': 'Data', 'settings.export': 'Export data',
  'settings.notifications': 'Notifications & Alarms',
  'settings.assistant': 'Voice Assistant', 'settings.about': 'About',

  // Voice assistant
  'voice.start': 'Start voice chat', 'voice.stop': 'Stop voice assistant',
  'voice.listening': "Hey! I'm listening.",
  'voice.off': 'Okay, talk to you later. Tap the mic when you need me.',
};

export type Dict = Partial<typeof en>;
type Params = Record<string, string | number>;

const dicts: Record<Lang, Dict> = {
  en,

  hi: {
    'nav.home': 'होम', 'nav.today': 'आज', 'nav.tasks': 'कार्य',
    'nav.calendar': 'कैलेंडर', 'nav.productivity': 'उत्पादकता',
    'nav.projects': 'प्रोजेक्ट', 'nav.goals': 'लक्ष्य', 'nav.library': 'लाइब्रेरी',
    'nav.stats': 'इनसाइट्स', 'nav.focus': 'फ़ोकस', 'nav.settings': 'सेटिंग्स',
    'nav.more': 'और', 'nav.allSections': 'सभी सेक्शन',
    'nav.notes': 'नोट्स', 'nav.ideas': 'आइडिया', 'nav.reminders': 'रिमाइंडर',
    'nav.review': 'समीक्षा', 'nav.search': 'खोज',
    'auth.welcome': 'वापसी पर स्वागत है', 'auth.welcomeSub': 'अपने LifeOS में साइन इन करें।',
    'auth.email': 'ईमेल', 'auth.password': 'पासवर्ड',
    'auth.signIn': 'साइन इन', 'auth.createAccount': 'खाता बनाएँ',
    'auth.forgot': 'पासवर्ड भूल गए?', 'auth.guest': 'मेहमान के रूप में जारी रखें',
    'auth.tagline': 'आपका जीवन, व्यवस्थित',
    'auth.signOut': 'साइन आउट', 'auth.signOutConfirm': 'साइन आउट करें?',
    'qa.placeholder': 'कार्य जोड़ें… जैसे "जिम कल शाम 6 बजे !high"',
    'qa.add': 'जोड़ें', 'qa.cancel': 'रद्द करें', 'qa.more': 'और विकल्प',
    'common.save': 'सहेजें', 'common.delete': 'हटाएँ', 'common.edit': 'संपादित करें',
    'common.close': 'बंद करें', 'common.confirm': 'पुष्टि करें', 'common.done': 'पूर्ण',
    'common.today': 'आज', 'common.tomorrow': 'कल', 'common.yesterday': 'बीता कल',
    'common.overdue': 'विलंबित', 'common.completed': 'पूर्ण हुए', 'common.pending': 'शेष',
    'common.all': 'सभी', 'common.high': 'उच्च', 'common.medium': 'मध्यम', 'common.low': 'निम्न',
    'common.urgent': 'अत्यावश्यक', 'common.search': 'खोजें', 'common.loading': 'लोड हो रहा है…',
    'today.greetingMorning': 'सुप्रभात', 'today.greetingAfternoon': 'नमस्कार',
    'today.greetingEvening': 'शुभ संध्या',
    'today.dueToday': 'आज देय', 'today.noTasks': 'आज कुछ भी देय नहीं — शांति का आनंद लें।',
    'today.upcoming': 'आगामी',
    'tasks.addTask': 'कार्य जोड़ें', 'tasks.newTask': 'नया कार्य',
    'tasks.title': 'शीर्षक', 'tasks.dueDate': 'नियत तिथि', 'tasks.dueTime': 'समय',
    'tasks.priority': 'प्राथमिकता', 'tasks.project': 'प्रोजेक्ट',
    'settings.appearance': 'रूप-रंग', 'settings.premiumTheme': 'प्रीमियम थीम',
    'settings.mode': 'मोड', 'settings.modeDark': 'गहरा', 'settings.modeLight': 'हल्का',
    'settings.modeSystem': 'सिस्टम', 'settings.language': 'भाषा',
    'settings.security': 'सुरक्षा', 'settings.account': 'खाता',
    'common.synced': 'सिंक हो गया', 'common.offline': 'ऑफ़लाइन — पुनः प्रयास हेतु टैप करें',
  },

  zh: {
    'nav.home': '首页', 'nav.today': '今天', 'nav.tasks': '任务',
    'nav.calendar': '日历', 'nav.productivity': '效率',
    'nav.projects': '项目', 'nav.goals': '目标', 'nav.library': '资料库',
    'nav.stats': '统计', 'nav.focus': '专注', 'nav.settings': '设置',
    'nav.more': '更多', 'nav.allSections': '全部板块',
    'nav.notes': '笔记', 'nav.ideas': '点子', 'nav.reminders': '提醒',
    'nav.review': '回顾', 'nav.search': '搜索',
    'auth.welcome': '欢迎回来', 'auth.welcomeSub': '登录你的 LifeOS。',
    'auth.email': '邮箱', 'auth.password': '密码',
    'auth.signIn': '登录', 'auth.createAccount': '注册账户',
    'auth.forgot': '忘记密码？', 'auth.guest': '以访客身份继续',
    'auth.tagline': '你的生活，井然有序',
    'auth.signOut': '退出登录', 'auth.signOutConfirm': '退出登录？',
    'qa.placeholder': '添加任务… 试试"明天下午6点健身 !high"',
    'qa.add': '添加', 'qa.cancel': '取消', 'qa.more': '更多选项',
    'common.save': '保存', 'common.delete': '删除', 'common.edit': '编辑',
    'common.close': '关闭', 'common.confirm': '确认', 'common.done': '完成',
    'common.today': '今天', 'common.tomorrow': '明天', 'common.yesterday': '昨天',
    'common.overdue': '已逾期', 'common.completed': '已完成', 'common.pending': '待办',
    'common.all': '全部', 'common.high': '高', 'common.medium': '中', 'common.low': '低',
    'common.urgent': '紧急', 'common.search': '搜索', 'common.loading': '加载中…',
    'today.greetingMorning': '早上好', 'today.greetingAfternoon': '下午好',
    'today.greetingEvening': '晚上好',
    'today.dueToday': '今天到期', 'today.noTasks': '今天没有到期任务 — 享受轻松时光。',
    'today.upcoming': '即将到来',
    'tasks.addTask': '添加任务', 'tasks.newTask': '新任务',
    'tasks.title': '标题', 'tasks.dueDate': '截止日期', 'tasks.dueTime': '时间',
    'tasks.priority': '优先级', 'tasks.project': '项目',
    'settings.appearance': '外观', 'settings.premiumTheme': '高级主题',
    'settings.mode': '模式', 'settings.modeDark': '深色', 'settings.modeLight': '浅色',
    'settings.modeSystem': '跟随系统', 'settings.language': '语言',
    'settings.security': '安全', 'settings.account': '账户',
    'common.synced': '已同步', 'common.offline': '离线 — 点按重试',
  },

  ja: {
    'nav.home': 'ホーム', 'nav.today': '今日', 'nav.tasks': 'タスク',
    'nav.calendar': 'カレンダー', 'nav.productivity': '生産性',
    'nav.projects': 'プロジェクト', 'nav.goals': '目標', 'nav.library': 'ライブラリ',
    'nav.stats': 'インサイト', 'nav.focus': 'フォーカス', 'nav.settings': '設定',
    'nav.more': 'もっと', 'nav.allSections': 'すべてのセクション',
    'nav.notes': 'ノート', 'nav.ideas': 'アイデア', 'nav.reminders': 'リマインダー',
    'nav.review': 'レビュー', 'nav.search': '検索',
    'auth.welcome': 'おかえりなさい', 'auth.welcomeSub': 'LifeOS にサインインしてください。',
    'auth.email': 'メール', 'auth.password': 'パスワード',
    'auth.signIn': 'サインイン', 'auth.createAccount': 'アカウント作成',
    'auth.forgot': 'パスワードを忘れた？', 'auth.guest': 'ゲストとして続ける',
    'auth.tagline': 'あなたの人生を、整理整頓',
    'auth.signOut': 'サインアウト', 'auth.signOutConfirm': 'サインアウトしますか？',
    'qa.placeholder': 'タスクを追加… 例「ジム 明日 18時 !high」',
    'qa.add': '追加', 'qa.cancel': 'キャンセル', 'qa.more': '詳細オプション',
    'common.save': '保存', 'common.delete': '削除', 'common.edit': '編集',
    'common.close': '閉じる', 'common.confirm': '確認', 'common.done': '完了',
    'common.today': '今日', 'common.tomorrow': '明日', 'common.yesterday': '昨日',
    'common.overdue': '期限超過', 'common.completed': '完了', 'common.pending': '保留',
    'common.all': 'すべて', 'common.high': '高', 'common.medium': '中', 'common.low': '低',
    'common.urgent': '緊急', 'common.search': '検索', 'common.loading': '読み込み中…',
    'today.greetingMorning': 'おはようございます', 'today.greetingAfternoon': 'こんにちは',
    'today.greetingEvening': 'こんばんは',
    'today.dueToday': '今日が期限', 'today.noTasks': '今日の予定はありません — ゆったりと。',
    'today.upcoming': '今後の予定',
    'tasks.addTask': 'タスクを追加', 'tasks.newTask': '新しいタスク',
    'tasks.title': 'タイトル', 'tasks.dueDate': '期限日', 'tasks.dueTime': '時刻',
    'tasks.priority': '優先度', 'tasks.project': 'プロジェクト',
    'settings.appearance': '外観', 'settings.premiumTheme': 'プレミアムテーマ',
    'settings.mode': 'モード', 'settings.modeDark': 'ダーク', 'settings.modeLight': 'ライト',
    'settings.modeSystem': 'システム', 'settings.language': '言語',
    'settings.security': 'セキュリティ', 'settings.account': 'アカウント',
    'common.synced': '同期済み', 'common.offline': 'オフライン — タップで再試行',
  },

  es: {
    'nav.home': 'Inicio', 'nav.today': 'Hoy', 'nav.tasks': 'Tareas',
    'nav.calendar': 'Calendario', 'nav.productivity': 'Productividad',
    'nav.projects': 'Proyectos', 'nav.goals': 'Metas', 'nav.library': 'Biblioteca',
    'nav.stats': 'Análisis', 'nav.focus': 'Enfoque', 'nav.settings': 'Ajustes',
    'nav.more': 'Más', 'nav.allSections': 'Todas las secciones',
    'nav.notes': 'Notas', 'nav.ideas': 'Ideas', 'nav.reminders': 'Recordatorios',
    'nav.review': 'Repaso', 'nav.search': 'Buscar',
    'auth.welcome': 'Bienvenido de nuevo', 'auth.welcomeSub': 'Inicia sesión en tu LifeOS.',
    'auth.email': 'Correo', 'auth.password': 'Contraseña',
    'auth.signIn': 'Iniciar sesión', 'auth.createAccount': 'Crear cuenta',
    'auth.forgot': '¿Olvidaste tu contraseña?', 'auth.guest': 'Continuar como invitado',
    'auth.tagline': 'tu vida, organizada',
    'auth.signOut': 'Cerrar sesión', 'auth.signOutConfirm': '¿Cerrar sesión?',
    'qa.placeholder': 'Añade una tarea… prueba "gym mañana 18:00 !high"',
    'qa.add': 'Añadir', 'qa.cancel': 'Cancelar', 'qa.more': 'Más opciones',
    'common.save': 'Guardar', 'common.delete': 'Eliminar', 'common.edit': 'Editar',
    'common.close': 'Cerrar', 'common.confirm': 'Confirmar', 'common.done': 'Hecho',
    'common.today': 'Hoy', 'common.tomorrow': 'Mañana', 'common.yesterday': 'Ayer',
    'common.overdue': 'Atrasada', 'common.completed': 'Completada', 'common.pending': 'Pendiente',
    'common.all': 'Todas', 'common.high': 'Alta', 'common.medium': 'Media', 'common.low': 'Baja',
    'common.urgent': 'Urgente', 'common.search': 'Buscar', 'common.loading': 'Cargando…',
    'today.greetingMorning': 'Buenos días', 'today.greetingAfternoon': 'Buenas tardes',
    'today.greetingEvening': 'Buenas noches',
    'today.dueToday': 'Vence hoy', 'today.noTasks': 'Nada vence hoy — disfruta la calma.',
    'today.upcoming': 'Próximas',
    'tasks.addTask': 'Añadir tarea', 'tasks.newTask': 'Nueva tarea',
    'tasks.title': 'Título', 'tasks.dueDate': 'Fecha límite', 'tasks.dueTime': 'Hora',
    'tasks.priority': 'Prioridad', 'tasks.project': 'Proyecto',
    'settings.appearance': 'Apariencia', 'settings.premiumTheme': 'Tema premium',
    'settings.mode': 'Modo', 'settings.modeDark': 'Oscuro', 'settings.modeLight': 'Claro',
    'settings.modeSystem': 'Sistema', 'settings.language': 'Idioma',
    'settings.security': 'Seguridad', 'settings.account': 'Cuenta',
    'common.synced': 'Sincronizado', 'common.offline': 'Sin conexión — toca para reintentar',
  },

  fr: {
    'nav.home': 'Accueil', 'nav.today': "Aujourd'hui", 'nav.tasks': 'Tâches',
    'nav.calendar': 'Calendrier', 'nav.productivity': 'Productivité',
    'nav.projects': 'Projets', 'nav.goals': 'Objectifs', 'nav.library': 'Bibliothèque',
    'nav.stats': 'Analyses', 'nav.focus': 'Concentration', 'nav.settings': 'Réglages',
    'nav.more': 'Plus', 'nav.allSections': 'Toutes les sections',
    'nav.notes': 'Notes', 'nav.ideas': 'Idées', 'nav.reminders': 'Rappels',
    'nav.review': 'Bilan', 'nav.search': 'Rechercher',
    'auth.welcome': 'Bon retour', 'auth.welcomeSub': 'Connectez-vous à votre LifeOS.',
    'auth.email': 'E-mail', 'auth.password': 'Mot de passe',
    'auth.signIn': 'Se connecter', 'auth.createAccount': 'Créer un compte',
    'auth.forgot': 'Mot de passe oublié ?', 'auth.guest': 'Continuer en invité',
    'auth.tagline': 'votre vie, organisée',
    'auth.signOut': 'Se déconnecter', 'auth.signOutConfirm': 'Se déconnecter ?',
    'qa.placeholder': 'Ajouter une tâche… essayez « sport demain 18h !high »',
    'qa.add': 'Ajouter', 'qa.cancel': 'Annuler', 'qa.more': "Plus d'options",
    'common.save': 'Enregistrer', 'common.delete': 'Supprimer', 'common.edit': 'Modifier',
    'common.close': 'Fermer', 'common.confirm': 'Confirmer', 'common.done': 'Terminé',
    'common.today': "Aujourd'hui", 'common.tomorrow': 'Demain', 'common.yesterday': 'Hier',
    'common.overdue': 'En retard', 'common.completed': 'Terminée', 'common.pending': 'En cours',
    'common.all': 'Toutes', 'common.high': 'Haute', 'common.medium': 'Moyenne', 'common.low': 'Basse',
    'common.urgent': 'Urgent', 'common.search': 'Rechercher', 'common.loading': 'Chargement…',
    'today.greetingMorning': 'Bonjour', 'today.greetingAfternoon': 'Bon après-midi',
    'today.greetingEvening': 'Bonsoir',
    'today.dueToday': "Dû aujourd'hui", 'today.noTasks': "Rien d'ici aujourd'hui — profitez du calme.",
    'today.upcoming': 'À venir',
    'tasks.addTask': 'Ajouter une tâche', 'tasks.newTask': 'Nouvelle tâche',
    'tasks.title': 'Titre', 'tasks.dueDate': "Date d'échéance", 'tasks.dueTime': 'Heure',
    'tasks.priority': 'Priorité', 'tasks.project': 'Projet',
    'settings.appearance': 'Apparence', 'settings.premiumTheme': 'Thème premium',
    'settings.mode': 'Mode', 'settings.modeDark': 'Sombre', 'settings.modeLight': 'Clair',
    'settings.modeSystem': 'Système', 'settings.language': 'Langue',
    'settings.security': 'Sécurité', 'settings.account': 'Compte',
    'common.synced': 'Synchronisé', 'common.offline': 'Hors ligne — touchez pour réessayer',
  },

  de: {
    'nav.home': 'Start', 'nav.today': 'Heute', 'nav.tasks': 'Aufgaben',
    'nav.calendar': 'Kalender', 'nav.productivity': 'Produktivität',
    'nav.projects': 'Projekte', 'nav.goals': 'Ziele', 'nav.library': 'Bibliothek',
    'nav.stats': 'Einblicke', 'nav.focus': 'Fokus', 'nav.settings': 'Einstellungen',
    'nav.more': 'Mehr', 'nav.allSections': 'Alle Bereiche',
    'nav.notes': 'Notizen', 'nav.ideas': 'Ideen', 'nav.reminders': 'Erinnerungen',
    'nav.review': 'Rückblick', 'nav.search': 'Suchen',
    'auth.welcome': 'Willkommen zurück', 'auth.welcomeSub': 'Melde dich bei deinem LifeOS an.',
    'auth.email': 'E-Mail', 'auth.password': 'Passwort',
    'auth.signIn': 'Anmelden', 'auth.createAccount': 'Konto erstellen',
    'auth.forgot': 'Passwort vergessen?', 'auth.guest': 'Als Gast fortfahren',
    'auth.tagline': 'dein Leben, organisiert',
    'auth.signOut': 'Abmelden', 'auth.signOutConfirm': 'Abmelden?',
    'qa.placeholder': 'Aufgabe hinzufügen… z.B. „Sport morgen 18 Uhr !high"',
    'qa.add': 'Hinzufügen', 'qa.cancel': 'Abbrechen', 'qa.more': 'Weitere Optionen',
    'common.save': 'Speichern', 'common.delete': 'Löschen', 'common.edit': 'Bearbeiten',
    'common.close': 'Schließen', 'common.confirm': 'Bestätigen', 'common.done': 'Fertig',
    'common.today': 'Heute', 'common.tomorrow': 'Morgen', 'common.yesterday': 'Gestern',
    'common.overdue': 'Überfällig', 'common.completed': 'Erledigt', 'common.pending': 'Offen',
    'common.all': 'Alle', 'common.high': 'Hoch', 'common.medium': 'Mittel', 'common.low': 'Niedrig',
    'common.urgent': 'Dringend', 'common.search': 'Suchen', 'common.loading': 'Wird geladen…',
    'today.greetingMorning': 'Guten Morgen', 'today.greetingAfternoon': 'Guten Tag',
    'today.greetingEvening': 'Guten Abend',
    'today.dueToday': 'Heute fällig', 'today.noTasks': 'Heute nichts fällig — genieß die Ruhe.',
    'today.upcoming': 'Bevorstehend',
    'tasks.addTask': 'Aufgabe hinzufügen', 'tasks.newTask': 'Neue Aufgabe',
    'tasks.title': 'Titel', 'tasks.dueDate': 'Fälligkeitsdatum', 'tasks.dueTime': 'Uhrzeit',
    'tasks.priority': 'Priorität', 'tasks.project': 'Projekt',
    'settings.appearance': 'Erscheinungsbild', 'settings.premiumTheme': 'Premium-Design',
    'settings.mode': 'Modus', 'settings.modeDark': 'Dunkel', 'settings.modeLight': 'Hell',
    'settings.modeSystem': 'System', 'settings.language': 'Sprache',
    'settings.security': 'Sicherheit', 'settings.account': 'Konto',
    'common.synced': 'Synchronisiert', 'common.offline': 'Offline — zum Wiederholen tippen',
  },

  pt: {
    'nav.home': 'Início', 'nav.today': 'Hoje', 'nav.tasks': 'Tarefas',
    'nav.calendar': 'Calendário', 'nav.productivity': 'Produtividade',
    'nav.projects': 'Projetos', 'nav.goals': 'Metas', 'nav.library': 'Biblioteca',
    'nav.stats': 'Análises', 'nav.focus': 'Foco', 'nav.settings': 'Configurações',
    'nav.more': 'Mais', 'nav.allSections': 'Todas as seções',
    'nav.notes': 'Notas', 'nav.ideas': 'Ideias', 'nav.reminders': 'Lembretes',
    'nav.review': 'Revisão', 'nav.search': 'Buscar',
    'auth.welcome': 'Bem-vindo de volta', 'auth.welcomeSub': 'Entre na sua LifeOS.',
    'auth.email': 'E-mail', 'auth.password': 'Senha',
    'auth.signIn': 'Entrar', 'auth.createAccount': 'Criar conta',
    'auth.forgot': 'Esqueceu a senha?', 'auth.guest': 'Continuar como convidado',
    'auth.tagline': 'sua vida, organizada',
    'auth.signOut': 'Sair', 'auth.signOutConfirm': 'Sair?',
    'qa.placeholder': 'Adicione uma tarefa… tente "academia amanhã 18h !high"',
    'qa.add': 'Adicionar', 'qa.cancel': 'Cancelar', 'qa.more': 'Mais opções',
    'common.save': 'Salvar', 'common.delete': 'Excluir', 'common.edit': 'Editar',
    'common.close': 'Fechar', 'common.confirm': 'Confirmar', 'common.done': 'Concluído',
    'common.today': 'Hoje', 'common.tomorrow': 'Amanhã', 'common.yesterday': 'Ontem',
    'common.overdue': 'Atrasada', 'common.completed': 'Concluída', 'common.pending': 'Pendente',
    'common.all': 'Todas', 'common.high': 'Alta', 'common.medium': 'Média', 'common.low': 'Baixa',
    'common.urgent': 'Urgente', 'common.search': 'Buscar', 'common.loading': 'Carregando…',
    'today.greetingMorning': 'Bom dia', 'today.greetingAfternoon': 'Boa tarde',
    'today.greetingEvening': 'Boa noite',
    'today.dueToday': 'Vence hoje', 'today.noTasks': 'Nada vence hoje — aproveite a calma.',
    'today.upcoming': 'Próximas',
    'tasks.addTask': 'Adicionar tarefa', 'tasks.newTask': 'Nova tarefa',
    'tasks.title': 'Título', 'tasks.dueDate': 'Data limite', 'tasks.dueTime': 'Hora',
    'tasks.priority': 'Prioridade', 'tasks.project': 'Projeto',
    'settings.appearance': 'Aparência', 'settings.premiumTheme': 'Tema premium',
    'settings.mode': 'Modo', 'settings.modeDark': 'Escuro', 'settings.modeLight': 'Claro',
    'settings.modeSystem': 'Sistema', 'settings.language': 'Idioma',
    'settings.security': 'Segurança', 'settings.account': 'Conta',
    'common.synced': 'Sincronizado', 'common.offline': 'Offline — toque para tentar de novo',
  },

  ar: {
    'nav.home': 'الرئيسية', 'nav.today': 'اليوم', 'nav.tasks': 'المهام',
    'nav.calendar': 'التقويم', 'nav.productivity': 'الإنتاجية',
    'nav.projects': 'المشاريع', 'nav.goals': 'الأهداف', 'nav.library': 'المكتبة',
    'nav.stats': 'الإحصاءات', 'nav.focus': 'التركيز', 'nav.settings': 'الإعدادات',
    'nav.more': 'المزيد', 'nav.allSections': 'كل الأقسام',
    'nav.notes': 'الملاحظات', 'nav.ideas': 'الأفكار', 'nav.reminders': 'التذكيرات',
    'nav.review': 'المراجعة', 'nav.search': 'بحث',
    'auth.welcome': 'مرحبًا بعودتك', 'auth.welcomeSub': 'سجّل الدخول إلى LifeOS.',
    'auth.email': 'البريد الإلكتروني', 'auth.password': 'كلمة المرور',
    'auth.signIn': 'تسجيل الدخول', 'auth.createAccount': 'إنشاء حساب',
    'auth.forgot': 'نسيت كلمة المرور؟', 'auth.guest': 'المتابعة كضيف',
    'auth.tagline': 'حياتك، منظمة',
    'auth.signOut': 'تسجيل الخروج', 'auth.signOutConfirm': 'تسجيل الخروج؟',
    'qa.placeholder': 'أضف مهمة… جرّب "الجيم غدًا 6م !high"',
    'qa.add': 'إضافة', 'qa.cancel': 'إلغاء', 'qa.more': 'خيارات أخرى',
    'common.save': 'حفظ', 'common.delete': 'حذف', 'common.edit': 'تعديل',
    'common.close': 'إغلاق', 'common.confirm': 'تأكيد', 'common.done': 'تم',
    'common.today': 'اليوم', 'common.tomorrow': 'غدًا', 'common.yesterday': 'أمس',
    'common.overdue': 'متأخرة', 'common.completed': 'مكتملة', 'common.pending': 'معلقة',
    'common.all': 'الكل', 'common.high': 'عالية', 'common.medium': 'متوسطة', 'common.low': 'منخفضة',
    'common.urgent': 'عاجلة', 'common.search': 'بحث', 'common.loading': 'جارٍ التحميل…',
    'today.greetingMorning': 'صباح الخير', 'today.greetingAfternoon': 'مساء الخير',
    'today.greetingEvening': 'مساء الخير',
    'today.dueToday': 'تستحق اليوم', 'today.noTasks': 'لا شيء مستحق اليوم — استمتع بالهدوء.',
    'today.upcoming': 'القادمة',
    'tasks.addTask': 'إضافة مهمة', 'tasks.newTask': 'مهمة جديدة',
    'tasks.title': 'العنوان', 'tasks.dueDate': 'تاريخ الاستحقاق', 'tasks.dueTime': 'الوقت',
    'tasks.priority': 'الأولوية', 'tasks.project': 'المشروع',
    'settings.appearance': 'المظهر', 'settings.premiumTheme': 'السمة المميزة',
    'settings.mode': 'الوضع', 'settings.modeDark': 'داكن', 'settings.modeLight': 'فاتح',
    'settings.modeSystem': 'النظام', 'settings.language': 'اللغة',
    'settings.security': 'الأمان', 'settings.account': 'الحساب',
    'common.synced': 'تمت المزامنة', 'common.offline': 'غير متصل — انقر لإعادة المحاولة',
  },

  ru: {
    'nav.home': 'Главная', 'nav.today': 'Сегодня', 'nav.tasks': 'Задачи',
    'nav.calendar': 'Календарь', 'nav.productivity': 'Продуктивность',
    'nav.projects': 'Проекты', 'nav.goals': 'Цели', 'nav.library': 'Библиотека',
    'nav.stats': 'Аналитика', 'nav.focus': 'Фокус', 'nav.settings': 'Настройки',
    'nav.more': 'Ещё', 'nav.allSections': 'Все разделы',
    'nav.notes': 'Заметки', 'nav.ideas': 'Идеи', 'nav.reminders': 'Напоминания',
    'nav.review': 'Обзор', 'nav.search': 'Поиск',
    'auth.welcome': 'С возвращением', 'auth.welcomeSub': 'Войдите в свой LifeOS.',
    'auth.email': 'Эл. почта', 'auth.password': 'Пароль',
    'auth.signIn': 'Войти', 'auth.createAccount': 'Создать аккаунт',
    'auth.forgot': 'Забыли пароль?', 'auth.guest': 'Продолжить как гость',
    'auth.tagline': 'ваша жизнь — в порядке',
    'auth.signOut': 'Выйти', 'auth.signOutConfirm': 'Выйти?',
    'qa.placeholder': 'Добавить задачу… например «спортзал завтра 18:00 !high»',
    'qa.add': 'Добавить', 'qa.cancel': 'Отмена', 'qa.more': 'Ещё варианты',
    'common.save': 'Сохранить', 'common.delete': 'Удалить', 'common.edit': 'Изменить',
    'common.close': 'Закрыть', 'common.confirm': 'Подтвердить', 'common.done': 'Готово',
    'common.today': 'Сегодня', 'common.tomorrow': 'Завтра', 'common.yesterday': 'Вчера',
    'common.overdue': 'Просрочено', 'common.completed': 'Выполнено', 'common.pending': 'Ожидает',
    'common.all': 'Все', 'common.high': 'Высокий', 'common.medium': 'Средний', 'common.low': 'Низкий',
    'common.urgent': 'Срочно', 'common.search': 'Поиск', 'common.loading': 'Загрузка…',
    'today.greetingMorning': 'Доброе утро', 'today.greetingAfternoon': 'Добрый день',
    'today.greetingEvening': 'Добрый вечер',
    'today.dueToday': 'На сегодня', 'today.noTasks': 'На сегодня ничего — наслаждайтесь спокойствием.',
    'today.upcoming': 'Предстоящие',
    'tasks.addTask': 'Добавить задачу', 'tasks.newTask': 'Новая задача',
    'tasks.title': 'Название', 'tasks.dueDate': 'Срок', 'tasks.dueTime': 'Время',
    'tasks.priority': 'Приоритет', 'tasks.project': 'Проект',
    'settings.appearance': 'Внешний вид', 'settings.premiumTheme': 'Премиум-тема',
    'settings.mode': 'Режим', 'settings.modeDark': 'Тёмный', 'settings.modeLight': 'Светлый',
    'settings.modeSystem': 'Системный', 'settings.language': 'Язык',
    'settings.security': 'Безопасность', 'settings.account': 'Аккаунт',
    'common.synced': 'Синхронизировано', 'common.offline': 'Офлайн — нажмите, чтобы повторить',
  },
};

// --- Persistence + detection ---
const KEY = 'lifeos.lang';

export function getLang(): Lang {
  try {
    const v = localStorage.getItem(KEY) as Lang | null;
    if (v && v in dicts) return v;
  } catch { /* ignore */ }
  return 'en';
}

export function setLangStored(l: Lang): void {
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
}

export function dirFor(l: Lang): 'ltr' | 'rtl' {
  return RTL.includes(l) ? 'rtl' : 'ltr';
}

// --- Lookup ---
export function translate(l: Lang, key: string, params?: Params): string {
  const raw = (dicts[l] as Record<string, string | undefined>)?.[key]
    ?? (en as Record<string, string | undefined>)[key]
    ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] !== undefined ? String(params[name]) : `{${name}}`);
}

// --- React wiring ---
interface I18nShape {
  t: (key: string, params?: Params) => string;
  lang: Lang;
  setLang: (l: Lang) => void;
  dir: 'ltr' | 'rtl';
}

export const I18nContext = createContext<I18nShape | null>(null);

export function useI18n(): I18nShape {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Outside a provider (e.g. early render): English, no setter.
    return { t: (k, p) => translate('en', k, p), lang: 'en', setLang: () => {}, dir: 'ltr' };
  }
  return ctx;
}
