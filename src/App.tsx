import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LayoutDashboard, Users, Factory, Package, Pencil, ShoppingCart, Wallet, Truck, BarChart3, Settings, Plus, Search, ArrowUpRight, ChevronRight, Check, Download, RefreshCw, LogOut, Menu, X, CircleAlert, Clock, ShieldCheck, Banknote, Layers, Activity, ArrowDownLeft, ArrowUpRight as OutIcon, Undo2, Tv, Store, Printer, FileText, MessageCircle, History as HistoryIcon, Upload, type LucideIcon } from 'lucide-react';
import { acceptedOutsourceCost, actualCost, availableTask, cashBalance, estimatedCost, orderPaid, payrollDebt, reservedQty, shippedQty, stockQty, supplierDebt, supplierStagePlan, supplierStagePriced } from './domain';
import { customerLedger } from './receivables';
import { haptic } from './haptics';
import { Skeleton } from './Skeleton';
import { Swipeable } from './swipe';
import { isIos, isStandalone, shouldShowInstallBanner, type BeforeInstallPrompt } from './pwa';
import { bootstrapCompany, demoAdmin, discardPending, execute, exportData, freshDemo, mode, onLocalChange, onSyncChange, readDemo, retryPending, signOut, snapshot, supabase, syncStatus } from './repository';
import { dateOffset } from './seed';
import { nextDemoCommand, type SetupStepId } from './setup';
import { shipmentQty } from './sales';
import { machineReport, periodReport, shopReport, stockBalanceReport, withinPeriod } from './reports';
import { HealthSection } from './health';
import { CatalogSettings } from './components/CatalogSettings';
import { CustomerPicker } from './components/CustomerPicker';
import { OrderEditor } from './components/OrderEditor';
import { ShortageNotice } from './components/ShortageNotice';
import { orderShortage } from './shortage';
import { RouteTemplates } from './components/RouteTemplates';
import { SetupWizard } from './components/SetupWizard';
import { OrderPositions } from './components/OrderPositions';
import { ShipmentEditor, shippableLines } from './components/ShipmentEditor';
import { WorkTasks } from './components/WorkTasks';
import { DefectJournal } from './components/DefectJournal';
import { TaskActionButton } from './components/TaskActionButton';
import { WorkReview } from './components/WorkReview';
import { SeriesList } from './components/SeriesList';
import { RecipeCatalog } from './components/RecipeEditor';
import { PurchasePriceHistory } from './components/PurchasePriceHistory';
import { StockSaleEditor } from './components/StockSaleEditor';
import { CustomerLedger } from './components/CustomerLedger';
import { FinanceReports } from './components/FinanceReports';
import { PrintDocument } from './components/PrintDocument';
import { AppShell } from './components/AppShell';
import { AccessPanel } from './components/AccessPanel';
import { QuickSearch } from './components/QuickSearch';
import { quickMatches } from './quicksearch';
import { WidgetBoard } from './components/WidgetBoard';
import { WarehouseCatalog } from './components/WarehouseCatalog';
import { WarehouseAnalytics } from './components/WarehouseAnalytics';
import { SupplyNeeds } from './components/SupplyNeeds';
import { supplyNeeds } from './supply';
import { WarehouseSelect, WarehouseTransfer } from './components/WarehousePicker';
import { WarehouseSettings } from './components/WarehouseSettings';
import { MAIN_WAREHOUSE_ID } from './warehouse-default';
import { CashAnalytics } from './components/CashAnalytics';
import { SalesAnalytics } from './components/SalesAnalytics';
import SalaryPanel from './components/SalaryPanel';
import ExpensePanel from './components/ExpensePanel';
import LoansPanel from './components/LoansPanel';
import { DirectorConsole } from './components/DirectorConsole';
import { expenseLedger, expensesDebt } from './expenses';
import { loanLedger, loansDebt } from './loans';
import { CustomerCard } from './components/CustomerCard';
import { SupplierCard } from './components/SupplierCard';
import { FinanceStatements } from './components/FinanceStatements';
import { GuideFab, GuideHint, GuidePanel } from './components/Guide';
import { pageGuide, type GuideAction } from './guide';
import { BulkCashForm } from './components/BulkCashForm';
import { BackupPanel } from './components/BackupPanel';
import { DiagnosticsPanel } from './components/Diagnostics';
import { listDiagnostics, recordDiagnostic, reminderDue } from './diagnostics';
import { ERRORS_MAX, PENDING_MAX, readSeen, seenStorageKey, supportAlerts, visibleTickets, writeSeen, type SeenMap } from './support';
import { lastSnapshotMark, saveSnapshot, shouldSnapshot } from './backup';
import { ensureDailyCopy } from './cloudBackup';
import { ItemImport } from './components/ItemImport';
import { OrderHistory } from './components/OrderHistory';
import { EmployeeEditor, ItemEditor, OperationRateEditor } from './components/QuickEditors';
import { SortSelect } from './components/SortSelect';
import { customerKindLabel, customerKindOrder, customerKindPlural, type CustomerDraft } from './customers';
import { matchesQuery, matchesSearch, sortRows, type SortOption, type SortState } from './listview';
import { MobileNav } from './components/MobileNav';
import { SectionNav } from './components/SectionNav';
import { PanelBar } from './components/PanelBar';
import { normalizeRoute, panelsFor, parseHash, routeHash, type Route } from './sections';
import { CompanyOnboarding } from './components/CompanyOnboarding';
import { TelegramChat, ChatBadge } from './components/TelegramChat';
import { ChatError, chatErrorText, chatOverview, chatSendText, playChatChime, subscribeChat, type ChatOverview } from './chat';
import { orderAcceptedMessage } from './serviceNotify';
import { cashReceipt, invoice, routeSheet } from './documents';
import { acceptedWorkQty, boardTaskLabel, executorLabel, stageCostText, taskUnit, unitLabel, workTaskRows } from './work-view';
import { warehouseGroups } from './warehouse';
import { cashCategoryLabel } from './i18n';
import { AccountField, Amount, Badge, date, dateTime, Dialog, Empty, errorText, Field, GoButton, Metric, money, num, Section, statuses, Title } from './ui';
import type { Account, Actor, CashEntry, Command, CustomerKind, Employee, ItemKind, Order, OrderInput, Purchase, RouteLine, State, Status } from './types';
import { salaryLedger } from './salary';

const pages = [
  { id: 'dashboard', title: 'Umumiy ko‘rinish', icon: LayoutDashboard, group: 'BOSHQARUV' },
  { id: 'orders', title: 'Savdo va CRM', icon: Users },
  { id: 'history', title: 'Tarix va analitika', icon: HistoryIcon },
  { id: 'shops', title: 'Do‘konlar', icon: Store },
  { id: 'production', title: 'Ishlab chiqarish', icon: Factory },
  { id: 'warehouse', title: 'Ombor', icon: Package, group: 'RESURSLAR' },
  { id: 'series', title: 'Seriyalar va retseptlar', icon: Layers },
  { id: 'purchases', title: 'Ta’minot', icon: ShoppingCart },
  { id: 'people', title: 'Xodimlar', icon: Users },
  { id: 'logistics', title: 'Yetkazib berish', icon: Truck },
  { id: 'cash', title: 'Moliya va kassa', icon: Wallet, group: 'NAZORAT' },
  { id: 'analytics', title: 'Hisobotlar', icon: BarChart3 },
  { id: 'settings', title: 'Sozlamalar', icon: Settings },
];
type Modal = { type: string; id?: string } | null;
type OrderSortKey = 'number' | 'customer' | 'due' | 'price' | 'debt';
type CashSortKey = 'date' | 'amount' | 'category';
type PurchaseSortKey = 'date' | 'supplier' | 'sum';
type SupplierSortKey = 'name' | 'debt';
type PeopleSortKey = 'name' | 'earnings' | 'debt';
type ShipmentSortKey = 'date' | 'due' | 'qty';
const demoActorKey = 'aliya-erp-demo-actor';
const demoDisplay: Actor = { id: 'display', name: 'Sex ekrani', role: 'display', companyId: demoAdmin.companyId };
const storedDemoActor = (): Actor | null => {
  try {
    const raw = localStorage.getItem(demoActorKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Actor;
    if (typeof value.id !== 'string' || typeof value.name !== 'string' || !['admin', 'worker', 'display'].includes(value.role)) return null;
    const name = value.role === 'admin' && value.id === demoAdmin.id ? demoAdmin.name : value.role === 'display' ? demoDisplay.name : value.name;
    return { ...value, name, companyId: typeof value.companyId === 'string' && value.companyId ? value.companyId : demoAdmin.companyId };
  } catch { return null; }
};
const text = (form: FormData, name: string) => String(form.get(name) || '').trim();
const number = (form: FormData, name: string) => Number(form.get(name) || 0);
const account = (form: FormData, name = 'account') => text(form, name) as Account;

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [actor, setActor] = useState<Actor>(() => (mode === 'demo' && storedDemoActor()) || demoAdmin);
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash) ?? { section: 'dashboard', panel: '' });
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [authenticated, setAuthenticated] = useState(() => mode === 'cloud' || !!storedDemoActor());
  const [clock, setClock] = useState(() => new Date());
  const [loginError, setLoginError] = useState('');
  const [needsCompany, setNeedsCompany] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [orderView, setOrderView] = useState<'board' | 'table'>('board');
  const [cashFilter, setCashFilter] = useState('all');
  const [orderSort, setOrderSort] = useState<SortState<OrderSortKey> | null>({ field: 'due', direction: 'asc' });
  const [cashSort, setCashSort] = useState<SortState<CashSortKey> | null>({ field: 'date', direction: 'desc' });
  const [purchaseFilter, setPurchaseFilter] = useState('all');
  const [purchaseSort, setPurchaseSort] = useState<SortState<PurchaseSortKey> | null>({ field: 'date', direction: 'desc' });
  const [supplierSort, setSupplierSort] = useState<SortState<SupplierSortKey> | null>(null);
  const [peopleFilter, setPeopleFilter] = useState('all');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [peopleSort, setPeopleSort] = useState<SortState<PeopleSortKey> | null>(null);
  const [shipmentFilter, setShipmentFilter] = useState('all');
  const [shipmentSort, setShipmentSort] = useState<SortState<ShipmentSortKey> | null>({ field: 'date', direction: 'desc' });
  const [period, setPeriod] = useState('month');
  const [warehouseScope, setWarehouseScope] = useState(MAIN_WAREHOUSE_ID);
  const [guideOpen, setGuideOpen] = useState(false);
  const [diagDue, setDiagDue] = useState(() => reminderDue(localStorage));
  const [sync, setSync] = useState(syncStatus);
  const [supportSeen, setSupportSeen] = useState<SeenMap>(() => readSeen(localStorage, seenStorageKey(actor.companyId, actor.id)));
  const [chat, setChat] = useState<ChatOverview>({ linked: {}, unread: {}, totalUnread: 0 });
  const [chatCustomerId, setChatCustomerId] = useState<string | null>(null);
  const [chatRefresh, setChatRefresh] = useState(0);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPrompt | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as Event & BeforeInstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  const loadEpoch = useRef(0);
  useEffect(() => {
    const sync = () => setRoute(parseHash(window.location.hash) ?? { section: 'dashboard', panel: '' });
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    try {
      const result = await snapshot();
      if (epoch !== loadEpoch.current) return;
      setState(result.state);
      if (mode === 'cloud') setActor(result.actor);
      setSync(syncStatus());
      setAuthenticated(mode === 'cloud' || !!storedDemoActor());
      setNeedsCompany(false);
      setLoginError('');
    } catch (e) {
      if (epoch !== loadEpoch.current) return;
      const message = errorText(e);
      if (mode === 'cloud' && /not been linked/i.test(message)) {
        setNeedsCompany(true);
        setLoginError('');
        setState(null);
        return;
      }
      setLoginError(message);
      recordDiagnostic(localStorage, { at: new Date().toISOString(), kind: 'error', message, detail: 'snapshot' });
      if (mode === 'cloud') { setNotice({ message, error: true }); setState(null); }
    }
  }, []);
  useEffect(() => {
    if (!supabase) { void load(); return onLocalChange(() => setState(readDemo())); }
    void supabase.auth.getSession().then(({ data }) => { if (data.session) void load(); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setTimeout(() => void load(), 0);
      else { loadEpoch.current++; setAuthenticated(false); setNeedsCompany(false); setState(null); }
    });
    const channel = supabase.channel('erp-revision').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'erp_metadata' }, () => void load()).subscribe();
    const timer = window.setInterval(() => void supabase!.auth.getSession().then(({ data }) => { if (data.session) void load(); }), 15000);
    return () => { data.subscription.unsubscribe(); void supabase!.removeChannel(channel); clearInterval(timer); };
  }, [load]);
  useEffect(() => {
    if (actor.role !== 'display') return;
    const tick = window.setInterval(() => setClock(new Date()), 10000);
    const refresh = window.setInterval(() => void load(), 20000);
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scroll = calm ? 0 : window.setInterval(() => {
      document.querySelectorAll<HTMLElement>('.tv-cards').forEach(el => {
        if (el.scrollHeight > el.clientHeight + 8) el.scrollTop = el.scrollTop + 1 >= el.scrollHeight - el.clientHeight ? 0 : el.scrollTop + 1;
      });
    }, 90);
    return () => { clearInterval(tick); clearInterval(refresh); if (scroll) clearInterval(scroll); };
  }, [actor.role, load]);
  useEffect(() => {
    const unsubscribe = onSyncChange(() => setSync(syncStatus()));
    const connected = () => { if (mode === 'cloud') void load(); };
    window.addEventListener('online', connected);
    return () => { unsubscribe(); window.removeEventListener('online', connected); };
  }, [load]);
  useEffect(() => {
    if (actor.role !== 'admin' || !state) return;
    let live = true;
    void chatOverview(state.companyId)
      .then(next => { if (live) setChat(next); })
      .catch(() => { if (live) setChat({ linked: {}, unread: {}, totalUnread: 0 }); });
    return () => { live = false; };
  }, [actor.role, state?.companyId, state?.revision, chatRefresh]);
  useEffect(() => {
    if (actor.role !== 'admin' || !state) return;
    const customers = state.customers;
    return subscribeChat(state.companyId, event => {
      setChatRefresh(value => value + 1);
      if (event.type !== 'incoming' || event.message.sender !== 'client') return;
      if (chatCustomerId === event.message.customerId) return;
      playChatChime();
      const name = customers.find(customer => customer.id === event.message.customerId)?.name || 'Mijoz';
      setNotice({ message: `${name}: ${event.message.text.slice(0, 90) || 'Yangi fayl yuborildi'}`, error: false });
    });
  }, [actor.role, state?.companyId, chatCustomerId]);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(null), 6500); return () => clearTimeout(timer); } }, [notice]);
  useEffect(() => {
    if (!state) return;
    const now = new Date().toISOString();
    if (shouldSnapshot(lastSnapshotMark(localStorage), now)) saveSnapshot(localStorage, state, now);
  }, [state]);
  const cloudCopy = useRef({ done: false, running: false });
  useEffect(() => {
    if (mode !== 'cloud' || actor.role !== 'admin' || !state) return;
    const slot = cloudCopy.current;
    if (slot.done || slot.running) return;
    slot.running = true;
    void ensureDailyCopy(state)
      .then(result => {
        slot.done = true;
        if (result.ran) setNotice({ message: 'Kunlik bulut zaxira nusxasi olindi.', error: false });
      })
      .catch(e => recordDiagnostic(localStorage, { at: new Date().toISOString(), kind: 'error', message: errorText(e), detail: 'cloud-copy' }))
      .finally(() => { slot.running = false; });
  }, [state, actor.role]);

  useEffect(() => {
    setSupportSeen(readSeen(localStorage, seenStorageKey(actor.companyId, actor.id)));
  }, [actor.companyId, actor.id]);
  const markSeen = (ticketId: string, messageId: string) => {
    if (supportSeen[ticketId] === messageId) return;
    const next = { ...supportSeen, [ticketId]: messageId };
    setSupportSeen(next);
    writeSeen(localStorage, seenStorageKey(actor.companyId, actor.id), next);
  };

  const notifyServiceCustomer = async (before: State, command: Command, result: State) => {
    if (command.type !== 'order.create') return;
    const created = result.orders.find(order => !before.orders.some(previous => previous.id === order.id));
    if (!created) return;
    const customer = result.customers.find(row => row.id === created.customerId);
    if (!customer || customer.kind !== 'service') return;
    try {
      await chatSendText(customer.id, orderAcceptedMessage(customer, created, customerLedger(result, customer.id).debt));
      setNotice({ message: 'Buyurtma saqlandi. Telegram xabar yuborildi.', error: false });
    } catch (error) {
      const code = error instanceof ChatError ? error.code : 'network';
      setNotice({ message: `Buyurtma saqlandi, lekin Telegram xabar yuborilmadi: ${chatErrorText(code)}`, error: true });
    }
  };
  const apply = async (command: Command): Promise<State | null> => {
    if (!state || busyRef.current) return null;
    busyRef.current = true; setBusy(true);
    haptic('tap');
    try {
      const result = await execute(state, command, actor);
      setState(result.state);
      if (mode === 'cloud') setActor(result.actor);
      setSync(syncStatus());
      setNotice({ message: result.queued ? 'Oflayn navbatga saqlandi. Balanslar server tasdiqlagandan keyin o‘zgaradi.' : 'Amal saqlandi. Hisob yangilandi.', error: false });
      haptic('success');
      if (!result.queued) void notifyServiceCustomer(state, command, result.state);
      return result.state;
    } catch (e) {
      const message = errorText(e);
      setNotice({ message, error: true });
      haptic('warning');
      if (mode === 'demo') setState(readDemo()); else await load();
      return null;
    } finally { busyRef.current = false; setBusy(false); }
  };
  const run = async (command: Command): Promise<boolean> => (await apply(command)) !== null;
  const createCustomer = async (draft: CustomerDraft): Promise<string | null> => {
    const next = await apply({ type: 'customer.create', ...draft });
    if (!next) return null;
    const created = [...next.customers].reverse().find(customer => customer.name === draft.name && customer.phone === draft.phone);
    return created?.id ?? null;
  };
  const runAll = async (commands: Command[]): Promise<{ done: number; error: string | null }> => {
    if (!state || busyRef.current) return { done: 0, error: 'Boshqa amal bajarilmoqda' };
    busyRef.current = true; setBusy(true);
    let latest = state;
    let nextActor = actor;
    let done = 0;
    try {
      for (const command of commands) {
        const result = await execute(latest, command, nextActor);
        latest = result.state;
        nextActor = result.actor;
        done++;
      }
      setState(latest);
      if (mode === 'cloud') setActor(nextActor);
      setSync(syncStatus());
      setNotice({ message: `${done} ta pozitsiya saqlandi.`, error: false });
      return { done, error: null };
    } catch (e) {
      const message = errorText(e);
      if (done > 0) setState(latest);
      setNotice({ message, error: true });
      if (mode === 'demo') setState(readDemo()); else await load();
      return { done, error: message };
    } finally { busyRef.current = false; setBusy(false); }
  };
  const runSetupDemo = async (step: SetupStepId): Promise<boolean> => {
    if (!state || busyRef.current) return false;
    if (mode === 'cloud' && !syncStatus().online) {
      setNotice({ message: 'Demoni yuklash uchun internet aloqasi kerak.', error: true });
      return false;
    }
    busyRef.current = true; setBusy(true);
    haptic('tap');
    let latest = state;
    let nextActor = actor;
    let done = 0;
    try {
      for (let attempt = 0; attempt < 24; attempt++) {
        const command = nextDemoCommand(step, latest);
        if (!command) break;
        const result = await execute(latest, command, nextActor);
        latest = result.state;
        nextActor = result.actor;
        done++;
      }
      setState(latest);
      if (mode === 'cloud') setActor(nextActor);
      setSync(syncStatus());
      setNotice({ message: done > 0 ? `${done} ta demo yozuv qo‘shildi.` : 'Bu qadamning demo ma’lumotlari allaqachon yuklangan.', error: false });
      haptic('success');
      return true;
    } catch (e) {
      const message = errorText(e);
      if (done > 0) setState(latest);
      setNotice({ message, error: true });
      if (mode === 'demo') setState(readDemo()); else await load();
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  };
  const admin = actor.role === 'admin';
  const perms = actor.permissions ?? [];
  const can = (...keys: string[]) => keys.some(key => perms.includes(key));
  const pageGate: Record<string, boolean> = {
    orders: can('orders.view_all', 'orders.create'),
    warehouse: can('warehouse.view'),
    purchases: can('purchases.view'),
    cash: can('cash.view'),
    analytics: can('reports.view'),
    settings: can('settings.catalog', 'settings.access'),
  };
  const visiblePages = admin ? pages : pages.filter(p => p.id === 'production' || pageGate[p.id]);
  const visibleIds = visiblePages.map(p => p.id);
  const canClaim = !admin && can('customers.claim');
  const showMineFilter = !admin && can('orders.edit_own') && !can('orders.view_all');
  const sellerOf = (id: string | null | undefined) => (id ? state?.employees.find(employee => employee.id === id)?.name ?? null : null);
  const effectiveRoute = normalizeRoute(route, visibleIds, admin);
  const current = effectiveRoute.section;
  const panel = effectiveRoute.panel;
  const currentPage = visiblePages.find(p => p.id === current) || visiblePages[0];
  const sectionPanels = panelsFor(current, admin);
  const panelTitle = sectionPanels.find(entry => entry.id === panel)?.title ?? '';
  const go = (section: string, target?: string) => {
    const next = normalizeRoute({ section, panel: target ?? '' }, visibleIds, admin);
    setRoute(next);
    setSearch(''); setSelectedOrder(null); setMenu(false);
    const hash = routeHash(next);
    if (window.location.hash !== hash) window.location.hash = hash;
  };
  useEffect(() => {
    const hash = routeHash(effectiveRoute);
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
  }, [effectiveRoute.section, effectiveRoute.panel]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [current, panel]);
  const openChat = (customerId: string) => { setSelectedOrder(null); setChatCustomerId(customerId); };
  const closeChat = () => { setChatCustomerId(null); setChatRefresh(value => value + 1); };
  const matches = (...values: (string | number | undefined)[]) => matchesQuery(values, search);
  const show = (type: string, id?: string) => setModal({ type, id });
  const setupManual = (step: SetupStepId) => {
    setModal(null);
    if (step === 'employees') show('employee');
    else if (step === 'materials') show('item');
    else if (step === 'operations') go('settings', 'malumotnoma');
    else show('order');
  };
  const runGuide = (action: GuideAction) => {
    setGuideOpen(false);
    if (action.kind === 'modal') show(action.modal);
    else go(action.page);
  };
  const enterDemo = (next: Actor) => {
    localStorage.setItem(demoActorKey, JSON.stringify(next));
    setActor(next);
    const start: Route = next.role === 'worker' ? { section: 'production', panel: '' } : { section: 'dashboard', panel: '' };
    setRoute(start);
    window.location.hash = routeHash(start);
    setAuthenticated(true);
  };
  const leaveSession = () => {
    if (mode === 'cloud') { void signOut().catch(e => setNotice({ message: errorText(e), error: true })); return; }
    localStorage.removeItem(demoActorKey);
    setActor(demoAdmin);
    setRoute({ section: 'dashboard', panel: '' });
    window.location.hash = '#/dashboard';
    setAuthenticated(false);
  };
  const exitUnlinkedSession = async () => {
    setBusy(true);
    loadEpoch.current++;
    try { await supabase!.auth.signOut(); } catch { /* mavjud bo‘lmagan hisob sessiyasi baribir mahalliy tozalanadi */ }
    setBusy(false);
    setNeedsCompany(false);
    setLoginError('');
    setAuthenticated(false);
    setState(null);
  };

  if (mode === 'cloud' && needsCompany) return <CompanyOnboarding busy={busy} error={loginError} onSignOut={() => void exitUnlinkedSession()} onSubmit={name => { void (async () => {
    setBusy(true);
    try {
      const result = await bootstrapCompany(name);
      setState(result.state);
      setActor(result.actor);
      setSync(syncStatus());
      setNeedsCompany(false);
      setLoginError('');
      setModal({ type: 'setup' });
    } catch (e) {
      setLoginError(errorText(e));
    } finally {
      setBusy(false);
    }
  })(); }} />;
  if (!authenticated || !state) return <div className="login-shell"><div className="login-story"><div className="brand big"><span>A</span> ALIYA <small>ERP</small></div><h1>Birinchi qo‘ng‘iroqdan<br />tayyor mebelgacha.</h1><p>Buyurtmalar, sex, ombor va pul.<br />Bitta tizim. Bitta ishonchli hisob.</p><div className="story-stages">BUYURTMA <ChevronRight size={18} /> SEX <ChevronRight size={18} /> YETKAZIB BERISH</div></div><section className="login-card"><ShieldCheck size={28} /><h2>{mode === 'cloud' ? 'Korxonaga kirish' : state ? 'Tizimda kim ishlaydi?' : 'Yuklanmoqda'}</h2>{!state && mode === 'demo' && <Skeleton rows={3} />}<p>{mode === 'cloud' ? 'Supabase Auth orqali shaxsiy kirish. Rolni egasi tayinlaydi.' : state ? 'Demo rejim: profil tanlanadi. Huquqlar umumiy bazadagi tegishli kirish bilan bir xil.' : 'Namoyish hisobi tayyorlanmoqda.'}</p>{mode === 'cloud' && <form onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); const { error } = await supabase!.auth.signInWithPassword({ email: text(form, 'email'), password: text(form, 'password') }); setBusy(false); if (error) setLoginError(error.message); }}><Field label="Email"><input name="email" type="email" autoComplete="username" required /></Field><Field label="Parol"><input name="password" type="password" autoComplete="current-password" required /></Field><button className="primary full" disabled={busy}>{busy ? 'Kirilmoqda…' : 'Kirish'}</button></form>}{mode === 'demo' && state && <div className="login-profiles"><button onClick={() => enterDemo(demoAdmin)}><ShieldCheck size={18} /><b>Egasi</b><small>Buyurtmalar, sex, ombor, pul, sozlamalar</small></button>{state.employees.filter(e => e.active).map(emp => <button key={emp.id} onClick={() => enterDemo({ id: emp.id, name: emp.name, role: 'worker', companyId: state.companyId })}><Factory size={18} /><b>{emp.name}</b><small>Xodim: o‘z topshiriqlari va hisob-kitoblari</small></button>)}<button onClick={() => enterDemo(demoDisplay)}><Tv size={18} /><b>Sex ekrani</b><small>Faqat TVda buyurtmalar kanbani, summasiz</small></button></div>}{loginError && <div className="warning">{loginError}</div>}<small>{mode === 'cloud' ? 'Baza sxemasi va kirish profili kirishdan oldin sozlangan bo‘lishi kerak.' : 'Bir necha kishi ishlashi uchun sozlamalarda umumiy bazani ulang.'}</small></section></div>;

  const guide = pageGuide(state, current, actor);
  const supportTickets = visibleTickets(state.tickets, actor);
  const supportAlertCount = supportAlerts(supportTickets, actor, supportSeen);
  const supportErrors = () => listDiagnostics(localStorage).slice(0, ERRORS_MAX).map(row => row.message);
  const pendingGuideSteps = guide.steps.filter(step => !step.done).length;
  const customerName = (id: string) => state.customers.find(c => c.id === id)?.name || 'Mijoz';
  const customerPhone = (id: string) => state.customers.find(c => c.id === id)?.phone || '';
  const employeeName = (id: string) => state.employees.find(c => c.id === id)?.name || 'Xodim';
  const party = (o: Order) => o.kind === 'series' ? 'Ombor seriyasi · mijozsiz' : customerName(o.customerId);
  const kindName = (o: Order) => o.kind === 'service' ? 'Xizmat' : o.kind === 'series' ? 'Seriya' : 'Mebel';
  const positionHint = (o: Order) => { const open = o.lines.filter(line => line.status !== 'cancelled').length; return open > 1 ? ` · ${open} pozitsiya` : ''; };
  const orderSortOptions: SortOption<Order, OrderSortKey>[] = [
    { value: 'number', label: 'Raqam', get: o => o.number },
    { value: 'customer', label: 'Mijoz', get: o => party(o) },
    { value: 'due', label: 'Muddat', get: o => o.dueDate },
    { value: 'price', label: 'Summa', get: o => o.price },
    { value: 'debt', label: 'Qarz', get: o => o.price - orderPaid(state, o.id) },
  ];
  const orders = sortRows(state.orders.filter(o => o.kind !== 'series' && matchesSearch(search, [o.number, o.title, customerName(o.customerId)], customerPhone(o.customerId)) && (statusFilter === 'all' || o.status === statusFilter)), orderSortOptions, orderSort);
  const cashSortOptions: SortOption<CashEntry, CashSortKey>[] = [
    { value: 'date', label: 'Sana', get: c => c.createdAt },
    { value: 'amount', label: 'Summa', get: c => c.amount },
    { value: 'category', label: 'Kategoriya', get: c => c.category },
  ];
  const cashRows = sortRows(state.cash.filter(c => (cashFilter === 'all' || c.direction === cashFilter) && matches(c.note, c.category)), cashSortOptions, cashSort);
  const purchaseSortOptions: SortOption<Purchase, PurchaseSortKey>[] = [
    { value: 'date', label: 'Sana', get: p => p.createdAt },
    { value: 'supplier', label: 'Yetkazib beruvchi', get: p => state.suppliers.find(s => s.id === p.supplierId)?.name },
    { value: 'sum', label: 'Summa', get: p => p.lines.reduce((s, l) => s + l.qty * l.price, 0) },
  ];
  const purchaseRows = sortRows(state.purchases.filter(p => {
    const closed = p.lines.every(l => l.received >= l.qty);
    return (purchaseFilter === 'all' || (purchaseFilter === 'pending' ? !closed : closed)) && matches(p.number, state.suppliers.find(s => s.id === p.supplierId)?.name);
  }), purchaseSortOptions, purchaseSort);
  const supplierSortOptions: SortOption<State['suppliers'][number], SupplierSortKey>[] = [
    { value: 'name', label: 'Nomi', get: s => s.name },
    { value: 'debt', label: 'Qarz', get: s => supplierDebt(state, s.id) },
  ];
  const supplierRows = sortRows(state.suppliers, supplierSortOptions, supplierSort);
  const peopleSortOptions: SortOption<Employee, PeopleSortKey>[] = [
    { value: 'name', label: 'Ism', get: e => e.name },
    { value: 'earnings', label: 'Oylik', get: e => state.salaryPlans.filter(plan => plan.employeeId === e.id).sort((a, b) => b.fromMonth.localeCompare(a.fromMonth))[0]?.amount ?? 0 },
    { value: 'debt', label: 'To‘lanishi kerak', get: e => salaryLedger(state, e.id).owed },
  ];
  const people = sortRows(state.employees.filter(emp => (admin || emp.id === actor.id) && matches(emp.name) && (peopleFilter === 'all' || (peopleFilter === 'active' ? emp.active : !emp.active))), peopleSortOptions, peopleSort);
  const shipmentSortOptions: SortOption<State['shipments'][number], ShipmentSortKey>[] = [
    { value: 'date', label: 'Yaratilgan sana', get: s => s.createdAt },
    { value: 'due', label: 'Yetkazish sanasi', get: s => s.dueDate },
    { value: 'qty', label: 'Miqdor', get: s => shipmentQty(s) },
  ];
  const shipmentRows = sortRows(state.shipments.filter(s => shipmentFilter === 'all' || s.status === shipmentFilter), shipmentSortOptions, shipmentSort);
  const active = state.orders.filter(o => ['production', 'ready', 'shipped'].includes(o.status));
  const reviewCount = state.orders.filter(o => o.status === 'production')
    .reduce((sum, o) => sum + o.route.filter(t => t.executorKind === 'employee' && t.status === 'submitted').length, 0);
  const customerDebt = state.customers.reduce((sum, c) => sum + customerLedger(state, c.id).debt, 0);
  const shopRows = state.customers.filter(c => c.kind === 'shop').map(shop => ({ shop, ledger: customerLedger(state, shop.id) }));
  const shopTotals = shopRows.reduce((totals, row) => ({
    shipped: totals.shipped + row.ledger.shipped, paid: totals.paid + row.ledger.paid,
    debt: totals.debt + row.ledger.debt, advance: totals.advance + row.ledger.advance,
  }), { shipped: 0, paid: 0, debt: 0, advance: 0 });
  const finishedStock = state.items.filter(i => !i.customerId && i.kind === 'finished');
  const low = state.items.filter(i => !i.customerId && stockQty(state, i.id) - reservedQty(state, i.id) < i.minQty);
  const scopedWarehouse = state.warehouses.some(row => row.id === warehouseScope && row.active) ? warehouseScope : MAIN_WAREHOUSE_ID;
  const scopedLow = state.items.filter(i => !i.customerId && stockQty(state, i.id, scopedWarehouse) - reservedQty(state, i.id, scopedWarehouse) < i.minQty);
  const payrollTotal = state.employees.reduce((sum, emp) => sum + payrollDebt(state, emp.id), 0);
  const supplierTotal = state.suppliers.reduce((sum, supplier) => sum + Math.max(0, supplierDebt(state, supplier.id)), 0);
  const expensesTotal = expensesDebt(state);
  const loansTotal = loansDebt(state);
  const midnight = new Date().setHours(0, 0, 0, 0);
  const overdue = (o: Order) => o.status !== 'delivered' && o.status !== 'cancelled' && new Date(`${o.dueDate}T00:00:00`).getTime() < midnight;
  const stageInfo = (t: RouteLine) => {
    const key = t.status === 'completed' ? 'done' : t.status === 'submitted' ? 'review' : t.status === 'assigned' ? 'wait' : 'active';
    return { key, label: boardTaskLabel(t.status).toLowerCase() };
  };
  const myTasks = admin ? active.length + reviewCount : workTaskRows(state, actor).length;
  const order = state.orders.find(o => o.id === selectedOrder);
  const chatPartner = state.customers.find(c => c.id === chatCustomerId) ?? null;
  const monthName = new Date().toLocaleDateString('uz-UZ', { month: 'long', year: 'numeric' });
  const submitSimple = async (event: FormEvent<HTMLFormElement>, command: Command) => { event.preventDefault(); if (await run(command)) setModal(null); };
  const footer = <footer className="form-footer"><button type="button" className="secondary" onClick={() => setModal(null)} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Amalni saqlash'}</button></footer>;

  if (actor.role === 'display') {
    const board = [['draft', 'REJA'], ['production', 'SEXDA'], ['ready', 'TAYYOR'], ['shipped', 'YUBORILGAN']] as [Status, string][];
    return <div className="tv-shell"><header className="tv-head"><div className="tv-brand"><span>A</span>ALIYA<small>SEX EKRANI</small></div><div className="tv-counts">{board.slice(1).map(([key, label]) => <b key={key}>{state.orders.filter(o => o.kind !== 'series' && o.status === key).length}<small>{label}</small></b>)}<b>{state.orders.filter(o => o.kind !== 'series' && o.status === 'delivered').length}<small>YETKAZILGAN</small></b></div><div className="tv-meta"><Clock size={20} /><b>{clock.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}</b><small>{clock.toLocaleDateString('uz-UZ', { weekday: 'long', day: '2-digit', month: 'long' })}</small></div><button className="tv-exit" onClick={leaveSession}>Chiqish</button></header><div className="tv-board">{board.map(([stage, label]) => { const column = state.orders.filter(o => o.kind !== 'series' && o.status === stage).sort((a, b) => a.dueDate.localeCompare(b.dueDate)); return <section className="tv-col" key={stage}><header><b>{label}</b><span>{column.length}</span></header><div className="tv-cards">{column.map(o => <article className={overdue(o) ? 'tv-card late' : 'tv-card'} key={o.id}><span className="tv-num">{o.number} · {o.kind === 'service' ? 'xizmat' : customerName(o.customerId)}</span><h2>{o.title}</h2><p>{num(o.qty)} dona · muddat {date(o.dueDate)}{overdue(o) && <em>muddati o‘tgan</em>}</p><div className="tv-chips">{o.route.map(t => { const info = stageInfo(t); return <span className={`tv-chip ${info.key}`} key={t.id}>{t.name}<i>{executorLabel(state, t).split(' ')[0]}</i><em>{info.label}</em></span>; })}{!o.route.length && <span className="tv-chip wait">marshrut belgilanmagan</span>}</div></article>)}{!column.length && <p className="tv-empty">Bo‘sh</p>}</div></section>; })}</div></div>;
  }

  return <>
  <AppShell
    menu={menu} setMenu={setMenu}
    pageKey={`${current}:${panel}`}
    title={panelTitle ? `${currentPage.title} · ${panelTitle}` : currentPage.title}
    searchBox={admin
      ? <QuickSearch value={search} onChange={setSearch} result={quickMatches(state, search)}
          onCustomer={id => { setSearch(''); show('customerCard', id); }}
          onOrder={id => { setSearch(''); setSelectedOrder(id); }} />
      : <label className="search"><Search size={17} /><input aria-label="Bo‘limda qidirish" placeholder="Bo‘limda qidirish…" value={search} onChange={event => setSearch(event.target.value)} /></label>}
    onRefresh={() => void load()} busy={busy}
    liveLabel={mode === 'demo' ? 'Shu brauzerda' : !sync.online ? 'Oflayn' : sync.pending.length ? `Navbatda: ${sync.pending.length}` : 'Umumiy baza'}
    onLive={() => show('sync')}
    onSignOut={leaveSession}
    sidebar={<><div className="brand"><span>A</span><div>ALIYA<small>WORKSPACE / ERP</small></div><button className="icon-button mobile-only" aria-label="Menyuni yopish" onClick={() => setMenu(false)}><X size={18} /></button></div><div className="workspace-label"><i />Mebel ishlab chiqarish<small>O‘zbekiston · UZS</small></div><SectionNav pages={visiblePages} current={current} panel={panel} admin={admin} badges={{ production: myTasks, orders: chat.totalUnread, warehouse: low.length }} onNavigate={go} /><div className="sidebar-bottom"><div className="system-state"><ShieldCheck size={17} /><div>{mode === 'demo' ? 'Lokal demo rejim' : 'Himoyalangan kirish'}<small>{mode === 'demo' ? 'Korxonaning umumiy bazasi emas' : 'Supabase Auth · RLS'}</small></div></div><div className="profile"><div className="avatar">{actor.name.slice(0, 1)}</div><div><b>{actor.name}</b><small>{admin ? 'Egasi' : 'Xodim'}</small></div>{mode === 'demo' ? <button className="icon-button" aria-label="Chiqish va profilni almashtirish" title="Chiqish va profilni almashtirish" onClick={leaveSession}><LogOut size={17} /></button> : supabase && <button className="icon-button" aria-label="Chiqish" onClick={() => void signOut().catch(e => setNotice({ message: errorText(e), error: true }))}><LogOut size={17} /></button>}</div></div></>}
    banners={<>
    {mode === 'demo' && <div className="demo-banner"><span><CircleAlert size={15} />Namoyish: yozuvlar faqat shu brauzerda saqlanadi. Sex ishlashi uchun umumiy bazani ulang.</span><button onClick={() => go('settings', 'baza')}>Supabase ulash<ArrowUpRight size={14} /></button></div>}
    {mode === 'cloud' && (!sync.online || sync.pending.length > 0) && <div className="demo-banner"><span><CircleAlert size={15} />{sync.pending.some(p => p.status === 'rejected') ? 'Konflikt bor: qayta yuborishdan oldin amalni tekshiring.' : `Oflayn navbat: ${sync.pending.length}. Ekranda faqat server tasdiqlagan qoldiqlar.`}</span><button onClick={() => show('sync')}>Sinxronizatsiya<RefreshCw size={14} /></button></div>}
    {mode === 'cloud' && admin && diagDue && <div className="demo-banner"><span><CircleAlert size={15} />Haftalik diagnostika vaqti keldi: hisobotni yuklab, mutaxassisga yuboring.</span><button onClick={() => go('settings', 'baza')}>Sozlamalar<ArrowUpRight size={14} /></button></div>}
    {(() => {
      const standalone = isStandalone();
      const ios = isIos(navigator.userAgent);
      const available = !!installPrompt || ios;
      if (!shouldShowInstallBanner({ standalone, dismissed: installDismissed, available })) return null;
      return <div className="demo-banner install-banner">
        <span><Download size={15} />{ios ? 'Safari: Ulashish → «Bosh ekranga qo‘shish» orqali o‘rnating.' : 'Ilovani bosh ekranga o‘rnating.'}</span>
        {installPrompt
          ? <button onClick={() => { void installPrompt.prompt(); setInstallPrompt(null); }}>O‘rnatish</button>
          : <button onClick={() => setInstallDismissed(true)}>Yopish</button>}
      </div>;
    })()}
    <GuideHint guide={guide} onAction={runGuide} onOpen={() => setGuideOpen(true)} />
    </>}
    footer={<footer className="app-footer"><span>ALIYA ERP · UZS · {mode === 'demo' ? 'Lokal namoyish' : 'Umumiy baza'}</span><span>Hisob versiyasi {state.revision} · O‘zgarishlar amallar jurnali orqali</span>{!admin && mode === 'demo' && <button className="text-button" onClick={() => { setActor(demoAdmin); setRoute({ section: 'dashboard', panel: '' }); window.location.hash = '#/dashboard'; }}>Egasiga qaytish</button>}</footer>}
    mobileNav={<MobileNav pages={visiblePages} current={current} panel={panel} admin={admin} badge={myTasks} onNavigate={go} />}
    overlays={<>
      <GuideFab remaining={pendingGuideSteps} alert={supportAlertCount > 0} onClick={() => setGuideOpen(true)} />
      {guideOpen && <GuidePanel guide={guide} onAction={runGuide} close={() => setGuideOpen(false)} support={{
        tickets: supportTickets, actor, build: __BUILD_ID__, page: current, revision: state.revision,
        sync: sync.online ? 'online' : 'offline',
        // normalizeTicketContext rejects pending > PENDING_MAX during render
        pending: Math.min(PENDING_MAX, sync.pending.length),
        errors: supportErrors(), seen: supportSeen, onSeen: markSeen, run,
      }} />}
    </>}
  >
    <PanelBar panels={sectionPanels} current={panel} onSelect={id => go(current, id)} />
    {current === 'dashboard' && <>
      <Title eyebrow={`ISH KO‘RINISHI / ${monthName.toUpperCase()}`} title="Butun ishlab chiqarish. Bitta ekranda." description="Buyurtmalar, materiallar va pul bilan ayni damda nima bo‘lyapti." action={<button className="primary" onClick={() => show('order')}><Plus size={17} />Buyurtma qabul qilish</button>} />
      <div className="metrics"><Metric label="Ishdagi buyurtmalar" value={active.length} detail={`${state.orders.filter(o => o.status === 'draft').length} ishga tushishini kutmoqda`} icon={Factory} accent /><Metric label="Kassa va hisoblarda" value={money(cashBalance(state, 'cash') + cashBalance(state, 'bank'))} detail="Faqat haqiqiy pul harakati" icon={Wallet} /><Metric label="Mijozlar qarzi" value={money(customerDebt)} detail="Buyurtma va xizmatlar bo‘yicha yagona qarz" icon={ArrowUpRight} /><Metric label="E’tibor talab qiladi" value={low.length} detail={`${low.length} tanqislik`} icon={CircleAlert} /></div>
      <WidgetBoard state={state} chat={chat} onStage={stage => { setStatusFilter(stage); go('orders'); }} onGo={go} onOrder={id => setSelectedOrder(id)} onChat={openChat} />
      <Section title="Yagona bog‘langan hisob" hint="Har bir o‘tish jurnalda yozuv qoldiradi"><div className="workflow-note">{[{ icon: Users, title: 'Buyurtma va hisob-kitob', text: 'Bitta narx, bitta mijoz, bitta qarz' }, { icon: Package, title: 'Band qilish va materiallar', text: 'Avval mavjudlik, keyin ishga tushirish' }, { icon: Factory, title: 'Ish va qabul qilish', text: 'Qabul qilingan natija uchun hisob-kitob' }, { icon: Truck, title: 'Tayyorlik va yetkazib berish', text: 'Faqat tayyor miqdorni yuborish' }].map((step, i) => <div key={step.title}><span>{i + 1}</span><step.icon size={20} /><b>{step.title}</b><p>{step.text}</p></div>)}</div></Section>
    </>}

    {current === 'orders' && <>
      <Title eyebrow="SAVDO / CRM" title={panel === 'mijozlar' ? 'Mijozlar va ularning hisobi.' : 'Mebelga aylanadigan buyurtmalar.'} description={panel === 'mijozlar' ? 'Do‘konlar, oddiy mijozlar va xizmat buyurtmachilari — karta, qarz va Telegram chat.' : 'Mebel va alohida xizmatlar bitta hisobda. Ikki marta qarz va to‘lovsiz.'} action={panel === 'mijozlar' ? <button className="primary" onClick={() => show('customer')}><Users size={16} />Mijoz</button> : <div className="button-group"><button className="secondary" onClick={() => show('customer')}><Users size={16} />Mijoz</button><button className="primary" onClick={() => show('order')}><Plus size={17} />Buyurtma / xizmat</button></div>} />
      {panel === 'buyurtmalar' && <div className="metrics three"><Metric label="Qabul qilingan buyurtmalar" value={state.orders.filter(o => o.status !== 'cancelled').length} detail={`${state.orders.filter(o => o.kind === 'service').length} alohida xizmat`} icon={Users} /><Metric label="Buyurtmalar summasi" value={money(state.orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + o.price, 0))} detail="Shartnoma qiymati, kassa tushumi emas" icon={Layers} /><Metric label="To‘lanmagan" value={money(customerDebt)} detail="To‘lovlar aniq buyurtmaga bog‘langan" icon={Wallet} accent /></div>}
      {panel === 'buyurtmalar' && <Section title="Barcha buyurtmalar" action={<div className="section-tools"><div className="segmented tight">{[['board', 'Kanban'], ['table', 'Jadval']].map(([key, name]) => <button key={key} className={orderView === key ? 'selected' : ''} onClick={() => setOrderView(key as typeof orderView)}>{name}</button>)}</div><select aria-label="Buyurtma holati filtri" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="all">Barcha holatlar</option>{Object.entries(statuses).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select><SortSelect value={orderSort} onChange={setOrderSort} options={orderSortOptions} /></div>}>{orderView === 'board' ? <div className="kanban">{(statusFilter === 'all' ? ['draft', 'production', 'ready', 'shipped', 'delivered'] : [statusFilter]).map(stage => { const column = orders.filter(o => o.status === stage); return <section className="kanban-col" key={stage}><header><Badge status={stage as Status} /><b>{column.length}</b></header><div className="kanban-cards">{column.map(o => <Swipeable key={o.id} actions={[{ label: 'Tahrirlash', onSelect: () => show('orderEdit', o.id) }, ...(admin && o.status !== 'cancelled' ? [{ label: 'Arxiv', onSelect: () => show('cancelOrder', o.id) }] : [])]}><article className="kanban-card" tabIndex={0} onClick={() => setSelectedOrder(o.id)} onKeyDown={e => { if (e.key === 'Enter') setSelectedOrder(o.id); }}><span className="eyebrow">{o.number}<ChatBadge count={chat.unread[o.customerId] ?? 0} className="inline" /></span><b>{o.title}</b><small>{customerName(o.customerId)} · {num(o.qty)} dona{positionHint(o)} · <span className={overdue(o) ? 'debt' : ''}>muddat {date(o.dueDate)}</span></small><div className="stage-chips">{o.route.map(t => { const info = stageInfo(t); return <span className={`stage-chip ${info.key}`} key={t.id}>{t.name} · {info.label}<i>{executorLabel(state, t).split(' ')[0]}</i></span>; })}{!o.route.length && <span className="stage-chip wait">marshrut belgilanmagan</span>}</div><div className="kanban-foot"><span>{money(o.price)}</span>{o.status !== 'cancelled' && o.price > orderPaid(state, o.id) && <span className="debt">qarz {money(o.price - orderPaid(state, o.id))}</span>}</div>{admin && o.status === 'draft' && <button className="secondary small full" disabled={busy} onClick={e => { e.stopPropagation(); void run({ type: 'order.launch', orderId: o.id }); }}><Factory size={14} />Sexga ishga tushirish</button>}{admin && o.status === 'production' && o.materials.some(m => m.issuedQty < m.qty) && <button className="secondary small full" disabled={busy} onClick={e => { e.stopPropagation(); void run({ type: 'order.issue', orderId: o.id }); }}><Package size={14} />Materiallarni berish</button>}{admin && shippableLines(state, o).length > 0 && <button className="primary small full" onClick={e => { e.stopPropagation(); show('shipment', o.id); }}><Truck size={14} />Yuborish</button>}</article></Swipeable>)}{!column.length && <p className="kanban-empty">Bu holatda buyurtmalar yo‘q</p>}</div></section>; })}</div> : <div className="table-scroll cardable"><table><thead><tr><th>Buyurtma</th><th>Mijoz</th><th>Holat / muddat</th><th className="right">Qiymat</th><th className="right">Qarz</th><th /></tr></thead><tbody>{orders.map(o => <tr key={o.id}><td data-label="Buyurtma"><button className="row-link" onClick={() => setSelectedOrder(o.id)}>{o.number} · {o.title}</button><small>{kindName(o)} · {num(o.qty)} dona{positionHint(o)}</small></td><td data-label="Mijoz">{customerName(o.customerId)}<ChatBadge count={chat.unread[o.customerId] ?? 0} className="inline" /></td><td data-label="Holat / muddat"><Badge status={o.status} /><small>{date(o.dueDate)}</small></td><td data-label="Qiymat" className="right">{money(o.price)}</td><td data-label="Qarz" className="right debt">{money(o.price - orderPaid(state, o.id))}</td><td data-label="Amallar"><button className="icon-button" aria-label={`Ochish ${o.number}`} onClick={() => setSelectedOrder(o.id)}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div>}{!orders.length && <Empty text="Buyurtmalar topilmadi" />}</Section>}
      {panel === 'mijozlar' && <Section title="Mijozlar" hint="Do‘konlar, oddiy mijozlar va xizmat buyurtmachilari alohida guruhda" action={<select aria-label="Mijoz turi filtri" value={customerFilter} onChange={event => setCustomerFilter(event.target.value)}><option value="all">Barcha mijozlar · {state.customers.length}</option>{showMineFilter && <option value="mine">Mening mijozlarim · {state.customers.filter(c => c.sellerId === actor.id).length}</option>}{customerKindOrder.map(kind => <option key={kind} value={kind}>{customerKindPlural(kind)} · {state.customers.filter(c => c.kind === kind).length}</option>)}</select>}><div className="mini-cards">{state.customers.filter(c => (customerFilter === 'mine' ? c.sellerId === actor.id : customerFilter === 'all' || c.kind === customerFilter) && matchesSearch(search, [c.name, c.address], c.phone)).sort((left, right) => customerKindOrder.indexOf(left.kind) - customerKindOrder.indexOf(right.kind) || left.name.localeCompare(right.name, 'uz')).map(c => <article key={c.id}><div className="avatar pale">{c.name.slice(0, 1)}</div><div><b>{c.name}</b><small>{customerKindLabel(c.kind)}{c.employeeId ? ' · Xodim' : ''}</small><small>{c.phone || 'Telefon ko‘rsatilmagan'}</small><small>{c.address || 'Manzil ko‘rsatilmagan'}</small>{sellerOf(c.sellerId) && <small>Mas’ul: {sellerOf(c.sellerId)}</small>}</div><span>{state.orders.filter(o => o.customerId === c.id).length} buyurtma</span>{canClaim && !c.sellerId && <button className="secondary small" disabled={busy} onClick={() => void run({ type: 'customer.claim', customerId: c.id })}>Mening mijozim</button>}<button className="secondary small" onClick={() => show('customerCard', c.id)}><BarChart3 size={14} />Karta</button><button className="icon-button chat-open" aria-label={`${c.name} bilan Telegram chat`} title="Telegram chat" onClick={() => openChat(c.id)}><MessageCircle size={15} /><ChatBadge count={chat.unread[c.id] ?? 0} /></button></article>)}</div>{!state.customers.length && <Empty text="Birinchi mijozni qo‘shing" />}</Section>}
    </>}

    {current === 'shops' && <>
      <Title eyebrow="DO‘KONLAR / OMBOR SAVDOSI" title="Har bir do‘konning o‘z hisob-kitobi." description="Tayyor mahsulotni yuborish, katalog narxi, qarz va avans har bir do‘kon bo‘yicha alohida." action={<button className="primary" onClick={() => show('stockSale')}><Plus size={17} />Do‘konga yuborish</button>} />
      <div className="metrics three"><Metric label="Do‘konlarga yuborilgan" value={money(shopTotals.shipped)} detail={`${shopRows.reduce((sum, row) => sum + row.ledger.shipments.length, 0)} stornosiz yuborish`} icon={Store} /><Metric label="Do‘konlar to‘lagan" value={money(shopTotals.paid)} detail="Pul allaqachon kassa yoki bankda" icon={Banknote} /><Metric label="Do‘konlar qarzi" value={money(shopTotals.debt)} detail={shopTotals.advance > 0 ? `Avanslar: ${money(shopTotals.advance)}` : 'Hozircha avanslar yo‘q'} icon={ArrowUpRight} accent /></div>
      {panel === 'yuborish' && <Section title="Yuborish uchun tayyor mahsulot" hint="Sotish narxi nomenklatura katalogida yuritiladi"><div className="mini-cards">{finishedStock.map(i => <article key={i.id}><div className="attention-icon green"><Package size={20} /></div><div><b>{i.name}</b><small>Bo‘sh {num(stockQty(state, i.id) - reservedQty(state, i.id))} {i.unit} · narx {money(i.salePrice)}</small></div><button className="secondary" disabled={stockQty(state, i.id) - reservedQty(state, i.id) <= 0} onClick={() => show('stockSale')}>Yuborish</button></article>)}</div>{!finishedStock.length && <Empty text="Tayyor mahsulot seriya chiqarilgandan keyin paydo bo‘ladi" />}</Section>}
      {panel === 'hisob-kitob' && <Section title="Do‘konlar bilan hisob-kitob" hint="To‘lov oldingi yuborishlarni yopadi, ortig‘i avans bo‘lib qoladi"><div className="shops-grid">{shopRows.map(row => <CustomerLedger key={row.shop.id} customer={row.shop} ledger={row.ledger} busy={busy} run={run} />)}</div>{!shopRows.length && <Empty text="Savdo bo‘limida «Do‘kon» turidagi mijoz yarating" />}</Section>}
    </>}

    {current === 'production' && <>
      <Title eyebrow={panel === 'brak' ? 'SEX / BRAK' : admin ? 'SEX / MONITORING' : 'SHAXSIY TERMINAL'} title={panel === 'brak' ? 'Brak tarixi va yo‘qotilgan material.' : admin ? 'Materialdan natijagacha.' : `Sizning topshiriqlaringiz, ${actor.name}.`} description={panel === 'brak' ? 'Qayta ishlash talab qilgan miqdor, sabab va sarflangan materialning bahosi. Hech kimning ish haqidan ushlanmaydi.' : 'Ketma-ket bosqichlar, qismiy bajarish va qabul. Bosqich tannarxi mijoz narxiga teng emas.'} />
      {panel !== 'brak' && <>{admin ? <div className="production-board">{state.orders.filter(o => ['production', 'ready', 'shipped'].includes(o.status) && matches(o.number, o.title)).map(o => <section className="production-card" key={o.id}><header><div><span className="eyebrow">{o.number} / {kindName(o).toUpperCase()}</span><h2>{o.title}</h2><small>{num(o.qty)} dona · muddat {date(o.dueDate)}</small></div><Badge status={o.status} /></header>{admin && o.materials.some(m => m.issuedQty < m.qty) && <div className="material-warning"><Package size={17} />Materiallar band qilingan, lekin hali berilmagan<button disabled={busy} onClick={() => void run({ type: 'order.issue', orderId: o.id })}>Sexga berish</button><ShortageNotice rows={orderShortage(state, o)} onGo={go} onTransfer={row => show('transfer', `${row.itemId}:${row.warehouseId}`)} /></div>}<div className="task-list">{o.route.filter(t => admin || t.employeeId === actor.id).map((t, i) => { const submitted = state.reports.filter(r => r.taskId === t.id && r.status === 'submitted').reduce((s, r) => s + r.qty, 0); const available = availableTask(state, o.id, t.id); return <article className={t.completed >= t.planned ? 'task complete' : 'task'} key={t.id}><div className="task-count">{t.completed >= t.planned ? <Check size={18} /> : i + 1}</div><div className="task-info"><b>{t.name}</b><small>{executorLabel(state, t)} · {stageCostText(state, t)}</small><div className="progress-track"><div style={{ width: `${Math.min(100, t.completed / t.planned * 100)}%` }} /></div><small>Qabul qilindi {num(t.completed)} / {num(t.planned)}{submitted > 0 ? ` · tekshiruvda ${num(submitted)}` : ''}</small></div>{t.executorKind === 'supplier'
        ? <OutsourceStageActions task={t} orderStatus={o.status} busy={busy}
            onAccept={() => void run({ type: 'outsource.accept', taskId: t.id })}
            onPay={() => show('outsourcePay', t.id)} />
        : <TaskActionButton task={t} busy={busy} available={available} onReview={() => show('workReview', `${o.id}:${t.id}`)} onSubmit={() => show('work', `${o.id}:${t.id}`)} />}</article>; })}</div><footer><button className="text-button" onClick={() => setSelectedOrder(o.id)}>{admin ? 'Karta va kalkulyatsiya' : 'Buyurtma kartasi'}<ArrowUpRight size={14} /></button></footer></section>)}</div> : <WorkTasks state={state} actor={actor} busy={busy} run={run} />}{admin && !state.orders.some(o => o.status === 'production') && <Empty text="Faol topshiriqlar yo‘q. CRMdan buyurtmani ishga tushiring." />}</>}
      {admin && panel === 'brak' && <DefectJournal state={state} />}
    </>}

    {current === 'warehouse' && <>
      <Title eyebrow={panel === 'qoldiqlar' ? 'OMBOR / TAHLIL' : panel === 'taminot' ? 'OMBOR / TA’MINOT' : 'OMBOR / TASNIFLAGICH'} title={panel === 'qoldiqlar' ? 'Qoldiqlar qayerga ketmoqda.' : panel === 'taminot' ? 'Nima yetishmayotganini oldindan ko‘ring.' : 'Har bir list o‘z joyida.'} description={panel === 'qoldiqlar' ? 'Pozitsiya bo‘yicha xarid, ishlab chiqarishga berilgan miqdor va joriy qoldiq.' : panel === 'taminot' ? 'Ishlab chiqarishdagi buyurtmalar uchun bu omborda yetishmayotgan material. Bir tugma bilan xarid yaratiladi.' : '01–07 tasniflagich, alohida zagotovka va tayyor mahsulot omborlari. O‘z zaxiralari mijoz materiallaridan ajratilgan.'} action={<div className="section-tools"><WarehouseSelect warehouses={state.warehouses} value={scopedWarehouse} onChange={setWarehouseScope} />{panel === 'tasniflagich' && <div className="button-group"><button className="secondary" onClick={() => show('itemImport')}><Upload size={16} />Excel import</button><button className="secondary" onClick={() => show('customerReceive')}>Mijozdan qabul</button><button className="primary" onClick={() => show('item')}><Plus size={16} />Pozitsiya</button></div>}</div>} />
      <div className="metrics three"><Metric label="O‘z zaxiralari qiymati" value={money(state.items.filter(i => !i.customerId).reduce((s, i) => s + stockQty(state, i.id, scopedWarehouse) * i.cost, 0))} detail="O‘rtacha tortilgan tannarx" icon={Package} accent /><Metric label="Katalogdagi pozitsiyalar" value={state.items.length} detail={`${state.items.filter(i => i.customerId).length} mijoz pozitsiyasi`} icon={Layers} /><Metric label="To‘ldirish kerak" value={scopedLow.length} detail="Bo‘sh miqdor minimaldan past" icon={CircleAlert} /></div>
      {panel === 'tasniflagich' && <WarehouseCatalog state={state} warehouseId={scopedWarehouse} search={search} onEdit={id => show('itemEdit', id)} onCount={id => show('count', `${id}:${scopedWarehouse}`)} />}
      {panel === 'qoldiqlar' && <WarehouseAnalytics state={state} warehouseId={scopedWarehouse} search={search} />}
      {panel === 'taminot' && <SupplyNeeds state={state} warehouseId={scopedWarehouse} search={search} onPurchase={need => show('purchase', `${need.itemId}:${need.warehouseId}`)} />}
    </>}

    {current === 'series' && <>
      <Title eyebrow="KONVEYER / SERIYALAR" title="Standart buyurtmalardan alohida." description="Retseptlar, fasad almashtirishlari, zagotovkalar va tayyor zaxira. Seriya mijoz qarzini yaratmaydi va savdo kanbaniga tushmaydi." action={<button className="primary" onClick={() => show('item')}><Plus size={16} />Katalog pozitsiyasi</button>} />
      <div className="metrics three"><Metric label="Ishdagi retseptlar" value={state.recipes.filter(r => r.active).length} detail={`${state.recipes.reduce((sum, r) => sum + r.versions.length, 0)} versiya`} icon={Layers} /><Metric label="Sexdagi seriyalar" value={state.orders.filter(o => o.kind === 'series' && o.status === 'production').length} detail={`${state.orders.filter(o => o.kind === 'series' && o.status === 'draft').length} qoralama`} icon={Factory} accent /><Metric label="Seriyalarning tayyor zaxirasi" value={state.items.filter(i => i.kind === 'finished' && !i.customerId).reduce((sum, i) => sum + stockQty(state, i.id), 0)} detail="Ombordagi tayyor mahsulot birliklari" icon={Package} /></div>
      {panel === 'seriyalar' && <SeriesList state={state} busy={busy} run={run} onGo={go} />}
      {panel === 'retseptlar' && <RecipeCatalog state={state} busy={busy} run={run} />}
    </>}

    {current === 'purchases' && <>
      <Title eyebrow="TA’MINOT / YETKAZIB BERUVCHILAR" title="O‘z vaqtida xarid qiling. Fakt bo‘yicha to‘lang." description="Yetkazib beruvchiga buyurtma, qismiy qabul va hisob-kitoblar — alohida bog‘langan amallar." action={panel === 'xaridlar' ? <div className="button-group"><button className="secondary" onClick={() => show('supplier')}>Yetkazib beruvchi</button><button className="primary" onClick={() => show('purchase')}><Plus size={17} />Xarid</button></div> : panel === 'yetkazib-beruvchilar' ? <button className="primary" onClick={() => show('supplier')}>Yetkazib beruvchi</button> : undefined} />
      <div className="metrics three"><Metric label="Yetkazib beruvchilarga qarz" value={money(supplierTotal)} detail="Qabul qilingan materiallar minus to‘lovlar" icon={Wallet} accent /><Metric label="Yetkazib berish buyurtmalari" value={state.purchases.length} detail="Narx xaridda qotib qolgan" icon={ShoppingCart} /><Metric label="Qabulni kutmoqda" value={state.purchases.filter(p => p.lines.some(l => l.received < l.qty)).length} detail={`${low.length} material to‘ldirishni talab qiladi`} icon={Clock} /></div>
      {panel === 'xaridlar' && <Section title="Xaridlar" action={<div className="section-tools"><select aria-label="Xaridlar filtri" value={purchaseFilter} onChange={e => setPurchaseFilter(e.target.value)}><option value="all">Barcha xaridlar</option><option value="pending">Qabulni kutmoqda</option><option value="received">Qabul qilingan</option></select><SortSelect value={purchaseSort} onChange={setPurchaseSort} options={purchaseSortOptions} /></div>}><div className="purchase-list">{purchaseRows.map(p => <article key={p.id}><header><div><b>{p.number} · {state.suppliers.find(s => s.id === p.supplierId)?.name}</b><small>{dateTime(p.createdAt)} · buyurtma summasi {money(p.lines.reduce((s, l) => s + l.qty * l.price, 0))}{p.orderId ? ` · buyurtma ${state.orders.find(o => o.id === p.orderId)?.number ?? '—'}` : ''}</small></div><span className={`badge ${p.lines.every(l => l.received >= l.qty) ? 'ready' : 'draft'}`}><i />{p.lines.every(l => l.received >= l.qty) ? 'Qabul qilingan' : 'Kutilmoqda'}</span></header>{p.lines.map(l => <div className="purchase-line" key={l.id}><span>{state.items.find(i => i.id === l.itemId)?.name}<small>{money(l.price)} / dona</small></span><b>{num(l.received)} / {num(l.qty)}</b></div>)}<footer><button className="secondary" disabled={busy || p.lines.every(l => l.received >= l.qty)} onClick={() => show('receive', p.id)}>Materiallarni qabul qilish</button><button className="text-button" onClick={() => show('supplierPay', p.supplierId)}>Yetkazib beruvchiga to‘lash<ArrowUpRight size={14} /></button></footer></article>)}</div>{!state.purchases.length && <Empty text="Korxona materiallaridan xarid rasmiylashtiring" />}</Section>}
      {panel === 'yetkazib-beruvchilar' && <Section title="Yetkazib beruvchilar va qarzdorlik" action={<SortSelect value={supplierSort} onChange={setSupplierSort} options={supplierSortOptions} />}><div className="mini-cards">{supplierRows.map(s => { const balance = supplierDebt(state, s.id); const services = acceptedOutsourceCost(state, s.id);
        return <article key={s.id}><div><button className="row-link" onClick={() => show('supplierCard', s.id)}><b>{s.name}</b></button><small>{s.phone}</small>{services > 0 && <small>Xizmatlar: {money(services)}</small>}</div>
          <strong>{balance >= 0 ? money(balance) : `Avans ${money(-balance)}`}</strong>
          <button className="secondary" onClick={() => show('supplierPay', s.id)}>To‘lash</button></article>; })}</div></Section>}
      {panel === 'narxlar' && <PurchasePriceHistory state={state} />}
    </>}

    {current === 'people' && <>
      {panel !== 'oylik' && <Title eyebrow="HR / XODIMLAR VA OYLIK" title="Odamlar, oylik va bosqich tannarxi." description="Oylik reja, to‘lovlar, ushlab qolishlar va qabul qilingan ishning tannarxi — alohida." action={admin && panel === 'xodimlar' ? <button className="primary" onClick={() => show('employee')}><Plus size={16} />Xodim</button> : undefined} />}
      {panel === 'xodimlar' && <><div className="filter-bar"><select aria-label="Xodimlar filtri" value={peopleFilter} onChange={e => setPeopleFilter(e.target.value)}><option value="all">Barcha xodimlar</option><option value="active">Faqat faol</option><option value="inactive">Faqat nofaol</option></select><SortSelect value={peopleSort} onChange={setPeopleSort} options={peopleSortOptions} /></div>
      <div className="employee-grid">{people.map(emp => { const ledger = salaryLedger(state, emp.id); const plan = state.salaryPlans.filter(row => row.employeeId === emp.id).sort((a, b) => b.fromMonth.localeCompare(a.fromMonth))[0]; return <article className="employee-card" key={emp.id}><div className="employee-heading"><div className="avatar large">{emp.name.slice(0, 1)}</div><div><h2>{emp.name}</h2><span className={`badge ${emp.active ? 'ready' : 'debt'}`}><i />{emp.active ? 'Faol' : 'Nofaol'}</span></div></div><div className="employee-numbers"><div><small>Oylik</small><b>{money(plan?.amount ?? 0)}</b></div><div><small>To‘langan</small><b>{money(ledger.paidTotal)}</b></div><div><small>To‘lanishi kerak</small><strong>{money(ledger.owed)}</strong></div></div><footer><small>{state.reports.filter(r => r.employeeId === emp.id && r.status === 'accepted').length} qabul qilingan natija</small>{admin && <div className="button-group"><button className="secondary small" onClick={() => show('employeeEdit', emp.id)}><Pencil size={14} />Tahrirlash</button><button className="primary" disabled={ledger.owed <= 0} onClick={() => show('salaryPay', emp.id)}>To‘lash</button></div>}</footer></article>; })}</div></>}
      {admin && panel === 'stavkalar' && <Section title="Bosqich tannarxi" hint="Birlik tannarxi × qabul qilingan miqdor buyurtma tannarxiga tushadi. Yangi tannarx eski marshrutlarni qayta hisoblamaydi." action={<GoButton onClick={() => go('settings')}>To‘liq ma’lumotnoma</GoButton>}><div className="table-scroll cardable"><table><thead><tr><th>Bosqich</th><th>O‘lchov</th><th className="right">Birlik tannarxi</th><th className="right">Mijoz narxi</th><th className="right">Norma</th><th /></tr></thead><tbody>{state.operations.map(op => <tr key={op.id}><td data-label="Bosqich"><b>{op.name}</b><small>{op.active ? 'Faol' : 'O‘chirilgan'} · {op.employeeIds.length} xodim</small></td><td data-label="O‘lchov">{unitLabel(op.unit)}</td><td data-label="Birlik tannarxi" className="right"><b>{money(op.workerRate)}</b></td><td data-label="Mijoz narxi" className="right muted">{money(op.salePrice)}</td><td data-label="Norma" className="right">{num(op.standardMinutes)} daq.</td><td data-label="Amallar"><button className="icon-button" aria-label={`${op.name} tannarxini tahrirlash`} title="Tannarxni tahrirlash" onClick={() => show('operationRate', op.id)}><Pencil size={16} /></button></td></tr>)}</tbody></table></div>{!state.operations.length && <Empty text="Bosqichlar «Sozlamalar» bo‘limida yaratiladi" />}</Section>}
      {admin && panel === 'oylik' && <SalaryPanel state={state} onPlan={id => show('salaryPlan', id)} onPay={id => show('salaryPay', id)} onDeduct={id => show('salaryDeduct', id)} onReverseDeduction={id => show('salaryDeductReverse', id)} />}
    </>}

    {current === 'logistics' && <>
      <Title eyebrow="LOGISTIKA / YUBORISH" title="Tayyor — yetkazilgan degani emas." description="Qismlarga bo‘lib yuboring, mas’ulni tayinlang va yetkazishni tasdiqlang." action={<button className="primary" onClick={() => show('shipment')}><Plus size={16} />Yuborish</button>} />
      <div className="metrics three"><Metric label="Yuborishga tayyor" value={state.orders.filter(o => o.kind !== 'series' && ['ready', 'shipped'].includes(o.status) && shippedQty(state, o.id) < o.qty).length} detail="Faqat qabul qilingan mahsulot va xizmatlar" icon={Package} /><Metric label="Yo‘lda" value={state.shipments.filter(s => s.status === 'shipped').length} detail="Yetkazish tasdiqlanishini kutmoqda" icon={Truck} accent /><Metric label="Yetkazilgan" value={state.shipments.filter(s => s.status === 'delivered').length} detail="Tushum yuborishda tan olinadi" icon={Check} /></div>
      <Section title="Yetkazishlar reyestri" action={<div className="section-tools"><select aria-label="Yetkazishlar filtri" value={shipmentFilter} onChange={e => setShipmentFilter(e.target.value)}><option value="all">Barcha yetkazishlar</option><option value="shipped">Yo‘lda</option><option value="delivered">Yetkazilgan</option><option value="cancelled">Storno</option></select><SortSelect value={shipmentSort} onChange={setShipmentSort} options={shipmentSortOptions} /></div>}><div className="delivery-grid">{shipmentRows.map(s => { const o = s.orderId ? state.orders.find(order => order.id === s.orderId) : null; const customer = state.customers.find(c => c.id === s.customerId); return <article key={s.id}><header><Truck size={22} /><span className={`badge ${s.status === 'delivered' ? 'delivered' : s.status === 'cancelled' ? 'debt' : 'shipped'}`}><i />{s.status === 'delivered' ? 'Yetkazilgan' : s.status === 'cancelled' ? 'Storno' : 'Yo‘lda'}</span></header><h2>{o ? `${o.number} · ${o.title}` : `${customer?.name ?? 'Do‘kon'} · ombordan sotuv`}</h2><p>{customer?.name || 'Buyurtmachi topilmadi'}</p><div className="delivery-info"><span>Miqdor<b>{num(shipmentQty(s))} dona</b></span><span>Manzil<b>{s.address}</b></span><span>Asos<b>{s.kind === 'stock' ? 'Tayyor mahsulot' : 'Mijoz buyurtmasi'}</b></span><span>Muddat<b>{date(s.dueDate)}</b></span></div><button className="primary full" disabled={busy || s.status !== 'shipped'} onClick={() => void run({ type: 'shipment.deliver', shipmentId: s.id })}>{s.status === 'delivered' ? 'Yetkazish tasdiqlangan' : s.status === 'cancelled' ? 'Yuborish storinolangan' : 'Yetkazishni tasdiqlash'}</button>{admin && s.status !== 'cancelled' && <button className="secondary full print-action" onClick={() => show('invoice', s.id)}><FileText size={16} />Hisob-faktura</button>}</article>; })}</div>{!state.shipments.length && <Empty text="Yuborishlar buyurtma tayyor bo‘lgandan keyin paydo bo‘ladi" />}</Section>
    </>}

    {current === 'cash' && <>
      {panel !== 'xarajatlar' && panel !== 'zaymlar' && panel !== 'pult' && <Title eyebrow="MOLIYA / KASSA" title={panel === 'kassa' ? 'Yo‘qolmagan provodkalar bilan pul.' : 'Davr bo‘yicha hisob-kitob.'} description={panel === 'kassa' ? 'Naqd va bank. Kirim, chiqim, o‘tkazma va tarixni saqlagan holda storno.' : 'Mijozlar, ta’minotchilar va buyurtmalar bo‘yicha davr hisoboti. Har bir qator ochiladi: to‘lovlar, yuborishlar va xaridlar ko‘rinadi.'} action={panel === 'kassa' ? <div className="button-group"><button className="secondary" onClick={() => show('cashBulk')}><Plus size={17} />Bir nechta chiqim</button><button className="primary" onClick={() => show('cash')}><Plus size={17} />Provodka</button></div> : undefined} />}
      {panel === 'hisobotlar' ? <FinanceStatements state={state} actor={actor} search={search} onOpenCustomer={id => show('customerCard', id)} /> : panel === 'xarajatlar' ? <ExpensePanel state={state} onPlan={id => show('expensePlan', id ?? undefined)} onPay={id => show('expensePay', id)} /> : panel === 'zaymlar' ? <LoansPanel state={state} onSet={id => show('loanSet', id ?? undefined)} onDraw={id => show('loanDraw', id)} onRepay={id => show('loanRepay', id)} /> : panel === 'pult' ? <><Title eyebrow="MOLIYA / DIREKTOR PULTI" title="Pul qayerda, nima keladi va kimga qarzdormiz." description="Bitta ekranda qoldiqlar, debitor va kreditor qarzlar, kelgusi oy rejalari va e’tibor ro‘yxati." /><DirectorConsole state={state} onGo={go} onPayExpense={id => show('expensePay', id)} onRepayLoan={id => show('loanRepay', id)} onOpenCustomer={id => show('customerCard', id)} /></> : <>
      <div className="metrics three"><Metric label="Naqd pul" value={money(cashBalance(state, 'cash'))} detail="To‘liq jurnaldagi qoldiq" icon={Banknote} accent /><Metric label="Bank / karta" value={money(cashBalance(state, 'bank'))} detail="O‘tkazmalar foyda yaratmaydi" icon={Wallet} /><Metric label="Majburiyatlar" value={money(supplierTotal + payrollTotal + expensesTotal + loansTotal)} detail="Yetkazib beruvchilar, ish haqi, oylik xarajatlar va zaymlar" icon={CircleAlert} /></div>
      <Section title="Pul jurnali" hint="Mijozlar, yetkazib beruvchilar va xodimlarga to‘lovlarni tegishli kartadan o‘tkazing" action={<div className="section-tools"><select aria-label="Kassa filtri" value={cashFilter} onChange={e => setCashFilter(e.target.value)}><option value="all">Barcha harakatlar</option><option value="in">Kirim</option><option value="out">Chiqim</option><option value="transfer">O‘tkazma</option></select><SortSelect value={cashSort} onChange={setCashSort} options={cashSortOptions} /></div>}><div className="table-scroll cardable"><table><thead><tr><th>Sana / kategoriya</th><th>Asos</th><th>Hisob</th><th className="right">Summa</th><th /></tr></thead><tbody>{cashRows.map(c => { const reversed = state.cash.some(x => x.reversalOf === c.id); return <tr key={c.id}><td data-label="Sana / kategoriya"><b>{cashCategoryLabel(c.category)}</b><small>{c.number ? `${c.number} · ` : ''}{dateTime(c.createdAt)}{c.reversalOf ? ' · storno' : reversed ? ' · storinolangan' : ''}</small></td><td data-label="Asos">{c.note}<small>{({ manual: 'Qo‘lda kiritilgan', sale: 'Mijoz / do‘kon to‘lovi', supplier: 'Yetkazib beruvchiga to‘lov', payroll: 'Xodimga to‘lov', expense: 'Oylik xarajat to‘lovi', transfer: 'Hisoblar o‘rtasida o‘tkazma', loan: 'Zaym operatsiyasi' })[c.source]}</small></td><td data-label="Hisob">{c.account === 'cash' ? 'Naqd pul' : 'Bank'}{c.direction === 'transfer' ? ` → ${c.toAccount === 'cash' ? 'Naqd pul' : 'Bank'}` : ''}</td><td data-label="Summa" className={`right ${c.direction === 'in' ? 'positive' : c.direction === 'out' ? 'debt' : ''}`}><span className="cash-amount">{c.direction === 'in' ? <ArrowDownLeft size={16} /> : <OutIcon size={16} />}{money(c.amount)}</span></td><td data-label="Amallar">{c.number && <button className="icon-button" aria-label={`Chop etish ${c.number}`} title="Chop etish" onClick={() => show('cashReceipt', c.id)}><Printer size={17} /></button>}<button className="icon-button" disabled={busy || reversed || !!c.reversalOf} aria-label={`Storno ${cashCategoryLabel(c.category)} ${c.amount}`} onClick={() => show('reverse', c.id)}><Undo2 size={17} /></button></td></tr>; })}</tbody></table></div>{!state.cash.length && <Empty text="Avval kassa va bankka boshlang‘ich qoldiqlarni kiriting" />}</Section>
      <CashAnalytics state={state} />
      <div className="dashboard-grid"><Section title="Debitor qarzdorlik" hint="Mijozlar qancha qarzdor"><div className="debt-list">{state.orders.filter(o => o.status !== 'cancelled' && o.price - orderPaid(state, o.id) > 0.005).map(o => <button key={o.id} onClick={() => setSelectedOrder(o.id)}><div><b>{o.number} · {customerName(o.customerId)}</b><small>{o.title}</small></div><strong>{money(o.price - orderPaid(state, o.id))}</strong><ChevronRight size={16} /></button>)}</div></Section><Section title="Kreditor qarzdorlik" hint="Sizning majburiyatlaringiz"><div className="debt-list">{state.suppliers.filter(s => supplierDebt(state, s.id) > 0).map(s => <button key={s.id} onClick={() => show('supplierPay', s.id)}><div><b>{s.name}</b><small>Yetkazib beruvchi</small></div><strong>{money(supplierDebt(state, s.id))}</strong></button>)}{state.employees.filter(s => payrollDebt(state, s.id) > 0).map(s => <button key={s.id} onClick={() => show('salaryPay', s.id)}><div><b>{s.name}</b><small>Xodim</small></div><strong>{money(payrollDebt(state, s.id))}</strong></button>)}{[...new Set(state.expensePlans.map(p => p.planId))].map(planId => { const ledger = expenseLedger(state, planId); return ledger.owed > 0 ? <button key={planId} onClick={() => show('expensePay', planId)}><div><b>{ledger.title}</b><small>Oylik xarajat</small></div><strong>{money(ledger.owed)}</strong></button> : null; })}{state.loans.map(loan => { const ledger = loanLedger(state, loan.id); return ledger.owed > 0 ? <button key={loan.id} onClick={() => show('loanRepay', loan.id)}><div><b>{loan.title}</b><small>{loan.kind === 'loan' ? 'Zaym' : 'Investitsiya'}</small></div><strong>{money(ledger.owed)}</strong></button> : null; })}</div></Section></div>
      </>}
    </>}

    {current === 'history' && <>
      <Title eyebrow="TARIX / ANALITIKA" title={panel === 'sotuv' ? 'Nima sotilgani va qancha foyda.' : 'Yopilgan buyurtmalar izi bilan.'} description={panel === 'sotuv' ? 'Yuborish, tushum va to‘g‘ridan-to‘g‘ri xarajatlar davr bo‘yicha.' : 'Har bir tugallangan buyurtma, hujjatlar va to‘lovlar tarixi o‘zgarmaydi.'} />
      {panel === 'tarix' && <OrderHistory state={state} search={search} onOpen={id => setSelectedOrder(id)} onInvoice={id => show('invoice', id)} />}
      {panel === 'sotuv' && <SalesAnalytics state={state} />}
    </>}

    {current === 'analytics' && <Reports state={state} period={period} setPeriod={setPeriod} part={panel === 'sogliq' ? 'health' : 'finance'} />}
    {current === 'settings' && <>
      <Title eyebrow={panel === 'kirish' ? 'SOZLAMALAR / KIRISH' : panel === 'baza' ? 'SOZLAMALAR / BAZA' : 'SOZLAMALAR / MA’LUMOTNOMA'} title={panel === 'kirish' ? 'Kim nima ko‘radi.' : panel === 'baza' ? 'Baza, zaxira va diagnostika.' : 'Ishlab chiqarishning asosi.'} description={panel === 'kirish' ? 'Korxona profili, xodim hisoblari va kirish huquqlari.' : panel === 'baza' ? 'Umumiy baza, eksport, zaxira nusxalar va texnik hisobot.' : 'Dastgohlar, operatsiyalar, tannarx va jarayon qoidalari.'} />
      {panel === 'malumotnoma' && <>
      {mode === 'cloud' && admin && <Section title="Boshlang‘ich sozlash" hint="To‘rt qadam: xodimlar, materiallar, operatsiyalar va birinchi buyurtma"><div className="data-actions"><button className="secondary" onClick={() => show('setup')}>Sozlashni ochish</button><small>Demo faqat yetishmayotgan yozuvlarni qo‘shadi — mavjud ma’lumotlar saqlanadi.</small></div></Section>}
      <div className="dashboard-grid"><CatalogSettings state={state} busy={busy} run={run} onAddEmployee={() => show('employee')} onEditEmployee={id => show('employeeEdit', id)} /><RouteTemplates state={state} busy={busy} run={run} /></div>
      {admin && <WarehouseSettings state={state} busy={busy} run={run} />}
      </>}
      {panel === 'kirish' && <>
      <div className="dashboard-grid"><Section title="Korxona profili"><div className="settings-facts"><span>Asosiy valyuta<b>O‘zbek so‘mi · UZS</b></span><span>Ishlab chiqarish hisobi<b>Sozlanadigan marshrut</b></span><span>Xodimlar to‘lovi<b>Oylik, har oy belgilanadi</b></span><span>Ombor<b>O‘z materiallari + mijoz materiallari</b></span><span>Ma’lumotlar<b>{mode === 'demo' ? 'Faqat shu brauzer' : 'Umumiy Supabase bazasi'}</b></span></div>{mode === 'demo' && <p className="panel-footnote">Foydalanuvchini almashtirish: chap pastki burchakdagi «Chiqish», so‘ng profilni tanlang — Egasi, xodim yoki TV uchun «Sex ekrani». Tanlov shu brauzerda eslab qolinadi.</p>}</Section></div>
      <AccessPanel cloud={mode === 'cloud'} employees={state.employees} />
      </>}
      {panel === 'baza' && <>
      <Section title="Ma’lumotlar va tarix" hint="Eksport — qo‘shimcha nusxa. Asosiy zaxira pastdagi «Bulut zaxira nusxasi» bo‘limida."><div className="data-actions"><button className="secondary" onClick={() => exportData(state)}><Download size={16} />JSON eksporti</button>{mode === 'demo' && <button className="danger-button" onClick={() => show('reset')}>Faqat lokal demo ma’lumotlarni tozalash</button>}<small>Hisob versiyasi: {state.revision} · {state.audit.length} amal</small></div><div className="table-scroll cardable"><table><thead><tr><th>Sana / vaqt</th><th>Kim</th><th>Amal</th></tr></thead><tbody>{state.audit.slice(-20).reverse().map(a => <tr key={a.id}><td data-label="Sana / vaqt">{dateTime(a.createdAt)}</td><td data-label="Kim">{a.actorName}</td><td data-label="Amal">{a.action}</td></tr>)}</tbody></table></div></Section>
      <BackupPanel state={state} cloud={mode === 'cloud'} onRestored={() => void load()} />
      <DiagnosticsPanel state={state} actor={actor} mode={mode} build={__BUILD_ID__} sync={{ online: sync.online, pending: sync.pending.map(request => ({ status: request.status, type: request.command.type, error: request.error })) }} onExported={() => setDiagDue(reminderDue(localStorage))} />
      </>}
    </>}
  </AppShell>
    {order && !admin && <div className="drawer-overlay"><button className="drawer-shade" aria-label="Kartani yopish" onClick={() => setSelectedOrder(null)} /><aside className="order-drawer"><header><div><span className="eyebrow">{order.number} / {kindName(order).toUpperCase()}</span><h2>{order.title}</h2><p>{party(order)}</p></div><button className="icon-button" aria-label="Kartani yopish" onClick={() => setSelectedOrder(null)}><X size={20} /></button></header><div className="drawer-body"><div className="order-status"><Badge status={order.status} /><span>Muddat {date(order.dueDate)}</span>{overdue(order) && <strong className="debt">muddat o‘tgan</strong>}</div><h3>Bu buyurtmadagi bosqichlaringiz</h3>{order.route.filter(t => t.employeeId === actor.id).map((t, i) => { const info = stageInfo(t); return <div className="detail-line" key={t.id}><div><b>{i + 1}. {t.name}</b><small>{order.lines.find(line => line.id === t.lineId)?.title ?? order.title} · {info.label}</small></div><div><b>{num(t.completed)} / {num(t.planned)}</b>{t.status === 'in_progress' && availableTask(state, order.id, t.id) && <button className="secondary small" onClick={() => show('work', `${order.id}:${t.id}`)}>Natijani topshirish</button>}</div></div>; })}{!order.route.some(t => t.employeeId === actor.id) && <p className="subtle-note">Bu buyurtmada sizning bosqichlaringiz yo‘q.</p>}<p className="subtle-note">Buyurtma kalkulyatsiyasi, narxlari va to‘lovlari faqat egasiga ko‘rinadi.</p></div></aside></div>}
    {order && admin && <div className="drawer-overlay"><button className="drawer-shade" aria-label="Kartani yopish" onClick={() => setSelectedOrder(null)} /><aside className="order-drawer"><header><div><span className="eyebrow">{order.number} / {kindName(order).toUpperCase()}</span><h2>{order.title}</h2><p>{party(order)}</p></div><button className="icon-button" aria-label="Kartani yopish" onClick={() => setSelectedOrder(null)}><X size={20} /></button></header><div className="drawer-body"><div className="order-status"><Badge status={order.status} /><span>Muddat {date(order.dueDate)}</span></div>{order.kind !== 'series' && <div className="order-money"><div><small>Mijoz narxi</small><b>{money(order.price)}</b></div><div><small>To‘langan</small><b>{money(orderPaid(state, order.id))}</b></div><div><small>Qarz</small><strong>{money(order.price - orderPaid(state, order.id))}</strong></div></div>}{order.kind === 'series' && <div className="info-note">Ombor seriyasi: mijoz, shartnoma narxi va qarz yo‘q. Tannarx — faqat materiallar va qabul qilingan ish.</div>}<div className="drawer-buttons">{order.kind !== 'series' && order.status !== 'cancelled' && order.price > orderPaid(state, order.id) && <button className="primary" onClick={() => show('orderPay', order.id)}>To‘lovni qabul qilish</button>}{order.kind !== 'series' && ['draft', 'production', 'ready'].includes(order.status) && <button className="secondary" disabled={busy} onClick={() => show('orderEdit', order.id)}><Pencil size={16} />Tahrirlash</button>}{order.status === 'draft' && <button className="secondary" disabled={busy} onClick={() => void run({ type: 'order.launch', orderId: order.id })}><Factory size={16} />Sexga ishga tushirish</button>}{order.status === 'production' && order.lines.length === 1 && order.materials.some(m => m.issuedQty < m.qty) && <button className="secondary" disabled={busy} onClick={() => void run({ type: 'order.issue', orderId: order.id })}>Materiallarni berish</button>}{order.kind !== 'series' && shippableLines(state, order).length > 0 && <button className="primary" onClick={() => show('shipment', order.id)}>Yuborish</button>}{order.kind !== 'series' && <button className="secondary" onClick={() => openChat(order.customerId)}><MessageCircle size={16} />Telegram chat<ChatBadge count={chat.unread[order.customerId] ?? 0} className="inline" /></button>}<button className="secondary" onClick={() => show('route', order.id)}><Printer size={16} />Marshrut varaqasi</button>{order.kind !== 'series' && <button className="secondary" onClick={() => show('invoice', order.id)}><FileText size={16} />Hisob-faktura</button>}{['draft', 'production', 'ready'].includes(order.status) && <button className="text-button danger-text" onClick={() => show('cancelOrder', order.id)}>Buyurtmani bekor qilish</button>}</div><h3>Kalkulyatsiya</h3><div className="calculation"><span>Materiallar, reja<b>{money(order.materials.reduce((s, l) => s + l.qty * l.estimatedCost, 0))}</b></span><span>Bosqichlar tannarxi, reja<b>{money(order.route.filter(t => t.executorKind === 'employee').reduce((s, t) => s + t.rate * t.planned, 0))}</b></span><span>Pudratchi xizmati, reja<b>{money(order.route.reduce((s, t) => s + supplierStagePlan(t), 0))}</b></span><span>Boshqa xarajatlar, reja<b>{money(order.overhead)}</b></span><span className="total">Reja tannarxi<b>{money(estimatedCost(state, order))}</b></span><span>Reja marjasi<b>{money(order.price - estimatedCost(state, order))}</b></span><span className="total">To‘g‘ridan-to‘g‘ri xarajatlar, fakt<b>{money(actualCost(state, order))}</b></span></div><p className="subtle-note">Rejadagi boshqa xarajatlar to‘langan pul deb hisoblanmaydi. Fakt berilgan o‘z materiallari va qabul qilingan ishlarni o‘z ichiga oladi; umumiy xarajatlar alohida ko‘rsatiladi.</p><h3>Pozitsiyalar</h3><OrderPositions state={state} order={order} busy={busy} onIssue={lineId => void run({ type: 'order.issue', orderId: order.id, lineId })} onShip={lineId => show('shipment', `${order.id}:${lineId}`)} onCancel={lineId => { if (window.confirm('Bu pozitsiyani bekor qilasizmi? Berilgan materiallar omborga qaytadi, uning summasi buyurtmadan olinadi.')) void run({ type: 'orderLine.cancel', orderId: order.id, lineId }); }} /><h3>Mijoz to‘lovlari tarixi</h3>{state.cash.filter(c => c.source === 'sale' && c.customerId === order.customerId).map(c => <div className="detail-line" key={c.id}><span>{dateTime(c.createdAt)} · {c.account === 'cash' ? 'Naqd pul' : 'Bank'}{c.reversalOf ? ' · storno' : ''}</span><b>{c.direction === 'in' ? '+' : '−'}{money(c.amount)}</b></div>)}</div></aside></div>}

    {chatPartner && admin && <TelegramChat customer={chatPartner} companyId={state.companyId} chatId={chat.linked[chatPartner.id] ?? null} debt={customerLedger(state, chatPartner.id).debt} refreshKey={chatRefresh} onClose={closeChat} onChanged={() => setChatRefresh(value => value + 1)} onNotice={(message, error = false) => setNotice({ message, error })} />}

    {modal?.type === 'setup' && <SetupWizard state={state} busy={busy} online={sync.online} close={() => setModal(null)} runDemo={runSetupDemo} manual={setupManual} />}
    {modal?.type === 'route' && <PrintDocument model={{ type: 'route', data: routeSheet(state, modal.id!) }} close={() => setModal(null)} />}
    {modal?.type === 'invoice' && admin && <PrintDocument model={{ type: 'invoice', data: invoice(state, modal.id!, actor) }} close={() => setModal(null)} />}
    {modal?.type === 'cashReceipt' && admin && <PrintDocument model={{ type: 'cash', data: cashReceipt(state, modal.id!) }} close={() => setModal(null)} />}
    {modal?.type === 'order' && <OrderEditor state={state} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} busy={busy} createCustomer={createCustomer} onGo={(section, target) => { setModal(null); setNotice({ message: 'Buyurtma saqlanmadi, tahrirlash yopildi.', error: false }); go(section, target); }} />}
    {modal?.type === 'orderEdit' && (() => { const target = state.orders.find(o => o.id === modal.id); return target ? <OrderEditor state={state} order={target} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} busy={busy} createCustomer={createCustomer} onGo={(section, target) => { setModal(null); setNotice({ message: 'Buyurtma saqlanmadi, tahrirlash yopildi.', error: false }); go(section, target); }} /> : null; })()}
    {modal?.type === 'shipment' && <ShipmentEditor state={state} preset={{ orderId: (modal.id ?? '').split(':')[0] ?? '', lineId: modal.id?.split(':')[1] }} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} busy={busy} />}
    {modal?.type === 'itemEdit' && (() => { const target = state.items.find(i => i.id === modal.id); return target ? <ItemEditor item={target} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} /> : null; })()}
    {modal?.type === 'itemImport' && <ItemImport state={state} busy={busy} close={() => setModal(null)} save={runAll} />}
    {modal?.type === 'employeeEdit' && (() => { const target = state.employees.find(e => e.id === modal.id); return target ? <EmployeeEditor employee={target} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} /> : null; })()}
    {modal?.type === 'operationRate' && (() => { const target = state.operations.find(o => o.id === modal.id); return target ? <OperationRateEditor operation={target} items={state.items} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} /> : null; })()}
    {modal?.type === 'customerCard' && (() => { const customer = state.customers.find(c => c.id === modal.id); return customer ? <Dialog title={`${customer.name} · karta`} subtitle="Buyurtmalar, to‘lovlar, yetkazishlar va foyda bir joyda. Filtrlash va saralash ishlaydi." close={() => setModal(null)} wide><CustomerCard state={state} customerId={customer.id} sellerName={sellerOf(customer.sellerId)} onClaim={canClaim && !customer.sellerId ? () => void run({ type: 'customer.claim', customerId: customer.id }) : undefined} onOpenOrder={id => { setModal(null); setSelectedOrder(id); }} /></Dialog> : null; })()}
    {modal?.type === 'supplierCard' && (() => { const supplier = state.suppliers.find(row => row.id === modal.id); return supplier ? <Dialog title={`${supplier.name} · karta`} subtitle="Xaridlar, qabullar, to‘lovlar, autsors xizmatlari va materiallar qayerda ishlatilgani — filtr va saralash bilan." close={() => setModal(null)} wide><SupplierCard state={state} supplierId={supplier.id} onOpenOrder={id => { setModal(null); setSelectedOrder(id); }} onPay={() => show('supplierPay', supplier.id)} /></Dialog> : null; })()}
    {modal?.type === 'cashBulk' && <Dialog title="Bir nechta xarajat kiritish" subtitle="Har bir satr alohida kassa provodkasi bo‘lib saqlanadi." close={() => { if (!busy) setModal(null); }}><BulkCashForm busy={busy} close={() => setModal(null)} save={async commands => { const result = await runAll(commands); if (!result.error) setModal(null); }} /></Dialog>}
    {modal?.type === 'workReview' && (() => { const [orderId, taskId] = (modal.id ?? '').split(':'); return <WorkReview state={state} orderId={orderId} taskId={taskId} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />; })()}
    {modal?.type === 'stockSale' && <StockSaleEditor state={state} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} busy={busy} />}
    {modal?.type === 'purchase' && (() => { const [itemId, warehouseId] = (modal.id ?? '').split(':'); const preset = itemId && warehouseId ? { itemId, warehouseId } : undefined; return <PurchaseEditor state={state} preset={preset} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} busy={busy} />; })()}
    {modal?.type === 'transfer' && (() => { const [itemId, fromId] = (modal.id ?? '').split(':'); const item = state.items.find(row => row.id === itemId); return item ? <WarehouseTransfer state={state} itemId={item.id} fromId={fromId} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} busy={busy} /> : null; })()}
    {modal && !['setup', 'order', 'orderEdit', 'shipment', 'itemEdit', 'itemImport', 'employeeEdit', 'operationRate', 'purchase', 'stockSale', 'route', 'invoice', 'customerCard', 'supplierCard', 'cashBulk', 'workReview', 'transfer'].includes(modal.type) && <Dialog title={modalTitle(modal.type)} subtitle="Amal hisobdagi bog‘langan o‘zgarishlar bilan birga saqlanadi." close={() => { if (!busy) setModal(null); }}>
      {modal.type === 'sync' && <div className="form-body"><div className="info-note">{mode === 'demo' ? 'Demo rejim internetisiz shu brauzerda ishlaydi. Odamlar orasidagi sinxronizatsiya Supabase ulangandan keyin mavjud.' : 'Oflayn yozuvlar hisobdan alohida saqlanadi. Server huquqlar, pul va zaxirani qayta tekshiradi. Aloqa qaytgach navbat o‘sha IDlar bilan avtomatik yuboriladi.'}</div>{mode === 'cloud' && <><p>Oxirgi tasdiq: {sync.savedAt ? new Date(sync.savedAt).toLocaleString('uz-UZ') : 'yo‘q'}.</p><p className="subtle-note">Oflayn kirish — yangilangandan keyin 24 soatgacha. Yangi kartalar va bog‘langan amallar sinxronizatsiyadan keyin mavjud. Sahifaning oflayn yuklanishi birinchi tashrifdan keyin HTTPS orqali chop etilgan yig‘mada ishlaydi.</p><button className="secondary" disabled={busy} onClick={() => void load()}><RefreshCw size={16} />Sinxronizatsiyani takrorlash</button>{sync.pending.map((request, index) => <article className="sync-request" key={request.requestId}><b>{request.command.type}</b><small>{new Date(request.createdAt).toLocaleString('uz-UZ')} · {request.status === 'queued' ? 'Hali yuborilmagan' : request.status === 'uncertain' ? 'Natija noma’lum — avvalgi ID bilan takrorlaymiz' : 'Server rad etdi'}</small><p>{request.error ? errorText(request.error) : ''}</p><code>{request.requestId}</code><div className="button-group">{request.status === 'rejected' && index === 0 && <button className="secondary" disabled={busy} onClick={() => { if (!window.confirm('Summa va asosni tekshirdingizmi? Amal qayta tekshirilib, joriy versiyada yuboriladi.')) return; setBusy(true); void retryPending(request.requestId).then(result => { setState(result.state); setActor(result.actor); }).catch(e => setNotice({ message: errorText(e), error: true })).finally(() => setBusy(false)); }}>Tekshirdim, qayta yuborish</button>}{request.status !== 'uncertain' && <button className="text-button danger-text" disabled={busy} onClick={() => { if (!window.confirm('Server o‘tkazmagan bu yozuvni bekor qilasizmi?')) return; void discardPending(request.requestId).catch(e => setNotice({ message: errorText(e), error: true })); }}>Yozuvni bekor qilish</button>}</div></article>)}{!sync.pending.length && <Empty text="Barcha amallar server tomonidan tasdiqlangan" />}</>}</div>}
      {['customer', 'supplier', 'employee', 'item'].includes(modal.type) && <form onSubmit={event => { const form = new FormData(event.currentTarget); const type = modal.type; let command: Command; if (type === 'customer') command = { type: 'customer.create', name: text(form, 'name'), phone: text(form, 'phone'), address: text(form, 'address'), kind: text(form, 'kind') as CustomerKind }; else if (type === 'supplier') command = { type: 'supplier.create', name: text(form, 'name'), phone: text(form, 'phone') }; else if (type === 'employee') command = { type: 'employee.create', name: text(form, 'name') }; else { const customerId = text(form, 'customerId') || null; command = { type: 'item.create', name: text(form, 'name'), unit: text(form, 'unit'), minQty: number(form, 'minQty'), cost: 0, customerId, kind: customerId ? 'material' : text(form, 'kind') as ItemKind, salePrice: customerId ? 0 : number(form, 'salePrice'), category: text(form, 'category') || null }; } void submitSimple(event, command); }}><div className="form-body"><Field label="Nomi / ism"><input name="name" required maxLength={200} autoFocus /></Field>{['customer', 'supplier'].includes(modal.type) && <Field label="Telefon"><input name="phone" type="tel" maxLength={60} /></Field>}{modal.type === 'customer' && <><Field label="Mijoz turi"><select name="kind"><option value="customer">Jismoniy mijoz / buyurtmachi</option><option value="shop">Do‘kon — ombor savdosi</option><option value="service">Xizmat buyurtmachisi — bir martalik xizmat</option></select></Field><Field label="Yetkazish manzili"><input name="address" maxLength={500} /></Field></>}{modal.type === 'item' && <><div className="form-grid"><Field label="Pozitsiya turi"><select name="kind"><option value="material">Material</option><option value="blank">Zagotovka</option><option value="finished">Tayyor mahsulot</option></select></Field><Field label="O‘lchov birligi"><select name="unit"><option>dona</option><option>list</option><option>m</option><option>m²</option><option>kg</option><option>l</option></select></Field><Field label="Minimal zaxira"><input name="minQty" type="number" step="0.001" min="0" defaultValue={0} required /></Field><Field label="Sotish narxi, UZS"><input name="salePrice" type="number" step="0.01" min="0" defaultValue={0} /></Field></div><Field label="Kimning materiallari"><select name="customerId"><option value="">Korxona</option>{state.customers.map(c => <option key={c.id} value={c.id}>{c.name} · mijozniki</option>)}</select></Field><Field label="Ombor tasniflagichi"><select name="category"><option value="">Tasniflanmagan</option>{warehouseGroups.map(group => <optgroup key={group.code} label={`${group.code} · ${group.name}`}>{group.children.map(leaf => <option key={leaf.code} value={leaf.code}>{leaf.code} · {leaf.name}</option>)}</optgroup>)}</select></Field><p className="subtle-note">Nol qoldiq yaratiladi. Xarid narxi qabulda paydo bo‘ladi. Zagotovka yoki tayyor mahsulot retsept natijasi bo‘lishi mumkin. Mijoz materiallari qiymatsiz hisobga olinadi.</p></>}</div>{footer}</form>}
      {['orderPay', 'payrollPay'].includes(modal.type) && (() => { const order = modal.type === 'orderPay' ? state.orders.find(o => o.id === modal.id) : undefined; const amount = order ? Math.max(0, order.price - orderPaid(state, order.id)) : payrollDebt(state, modal.id!); return <form onSubmit={event => { const form = new FormData(event.currentTarget); const command: Command = order ? { type: 'customer.pay', customerId: order.customerId, amount: number(form, 'amount'), account: account(form) } : { type: 'payroll.pay', employeeId: modal.id!, amount: number(form, 'amount'), account: account(form) }; void submitSimple(event, command); }}><div className="form-body"><div className="payment-due"><small>{order ? 'Mijoz qarzdor' : 'To‘lanishi kerak'}</small><strong>{money(amount)}</strong></div><Amount defaultValue={amount} max={amount} /><AccountField /><p className="subtle-note">Mijoz to‘lovi umumiy hisobiga ketadi: avval oldingi yuborishlarni yopadi, ortig‘i avans bo‘lib qoladi.</p></div>{footer}</form>; })()}
      {modal.type === 'salaryPlan' && <SalaryPlanForm state={state} employeeId={modal.id!} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}
      {modal.type === 'salaryPay' && <SalaryPayForm employeeId={modal.id!} owed={payrollDebt(state, modal.id!)} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}
      {modal.type === 'supplierPay' && (() => { const supplier = state.suppliers.find(row => row.id === modal.id); return supplier
        ? <SupplierPayForm supplierId={supplier.id} orderId={null} category="supplier" defaultNote={`${supplier.name} · Xarid to‘lovi`}
          balance={supplierDebt(state, supplier.id)} busy={busy} close={() => setModal(null)}
          save={async command => { if (await run(command)) setModal(null); }} /> : null; })()}
      {modal.type === 'outsourcePay' && (() => { const hit = state.orders.flatMap(row => row.route.map(task => ({ order: row, task })))
        .find(row => row.task.id === modal.id); return hit?.task.supplierId
        ? <SupplierPayForm supplierId={hit.task.supplierId} orderId={hit.order.id} category="outsourcing"
          defaultNote={`${hit.order.number} · ${hit.task.name}`} balance={supplierDebt(state, hit.task.supplierId)}
          suggested={supplierStagePlan(hit.task)}
          busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} /> : null; })()}
      {modal.type === 'salaryDeduct' && <SalaryDeductForm state={state} employeeId={modal.id!} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}
      {modal.type === 'salaryDeductReverse' && (() => { const deduction = state.workerDeductions.find(row => row.id === modal.id); if (!deduction) return null; const employee = state.employees.find(row => row.id === deduction.employeeId); const customer = state.customers.find(row => row.id === deduction.customerId); return <form onSubmit={event => void submitSimple(event, { type: 'salary.deduct.reverse', deductionId: deduction.id })}><div className="form-body"><div className="warning">Ushlab qolish bekor qilinadi: mijoz qarzi va oylik qoldig‘i qayta tiklanadi. Kassa o‘zgarmaydi.</div><div className="settings-facts"><span>Xodim<b>{employee?.name}</b></span><span>Mijoz hisobi<b>{customer?.name ?? '—'}</b></span><span>Summa<b>{money(deduction.amount)}</b></span><span>Sana<b>{dateTime(deduction.createdAt)}</b></span></div></div><footer className="form-footer"><button type="button" className="secondary" onClick={() => setModal(null)} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Storno qilish'}</button></footer></form>; })()}
      {modal.type === 'expensePlan' && <ExpensePlanForm state={state} planId={modal.id ?? null} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}
      {modal.type === 'expensePay' && <ExpensePayForm planId={modal.id!} owed={expenseLedger(state, modal.id!).owed} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}
      {modal.type === 'loanSet' && <LoanSetForm state={state} loanId={modal.id ?? null} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}
      {modal.type === 'loanDraw' && <LoanDrawForm loanId={modal.id!} available={loanLedger(state, modal.id!).available} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}
      {modal.type === 'loanRepay' && <LoanRepayForm loanId={modal.id!} owed={loanLedger(state, modal.id!).owed} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}
      {modal.type === 'cash' && <CashForm busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}
      {modal.type === 'reverse' && <form onSubmit={event => { const form = new FormData(event.currentTarget); void submitSimple(event, { type: 'cash.reverse', entryId: modal.id!, note: text(form, 'note') }); }}><div className="form-body"><div className="warning">Asl yozuv qoladi. Javob yozuvi pul va bog‘langan qarzni o‘zgartiradi. Qayta storno qilish taqiqlangan.</div><Field label="Storno sababi"><input name="note" required maxLength={500} /></Field></div>{footer}</form>}
      {modal.type === 'count' && (() => { const [itemId, warehouseId] = (modal.id ?? '').split(':'); const scope = warehouseId || MAIN_WAREHOUSE_ID; const warehouse = state.warehouses.find(row => row.id === scope); const item = state.items.find(i => i.id === itemId); return <form onSubmit={event => { const form = new FormData(event.currentTarget); void submitSimple(event, { type: 'inventory.count', itemId, qty: number(form, 'qty'), note: text(form, 'note'), warehouseId: scope }); }}><div className="form-body"><p>{item?.name}{warehouse ? ` · ${warehouse.name}` : ''}</p><Field label="Haqiqiy miqdor"><input name="qty" type="number" min="0" step="0.001" defaultValue={stockQty(state, itemId, scope)} required /></Field><Field label="Asos / sabab"><input name="note" required maxLength={500} /></Field><p className="subtle-note">Faqat shu ombor qoldig‘i o‘zgaradi. Faol buyurtmalar bandidan pastga tushirib bo‘lmaydi.</p></div>{footer}</form>; })()}
      {modal.type === 'customerReceive' && <form onSubmit={event => { const form = new FormData(event.currentTarget); void submitSimple(event, { type: 'customer.receive', itemId: text(form, 'itemId'), qty: number(form, 'qty'), note: text(form, 'note') }); }}><div className="form-body"><Field label="Mijoz materiali"><select name="itemId" required><option value="">Materialni tanlang</option>{state.items.filter(i => i.customerId).map(i => <option key={i.id} value={i.id}>{i.name} · {customerName(i.customerId!)}</option>)}</select></Field><Field label="Miqdor"><input name="qty" type="number" min="0.001" step="0.001" required /></Field><Field label="Asos / hujjat"><input name="note" required maxLength={500} /></Field><p className="subtle-note">Pozitsiya bo‘lmasa, avval uni aniq mijoz materiali sifatida yarating.</p></div>{footer}</form>}
      {modal.type === 'work' && (() => { const [orderId, taskId] = modal.id!.split(':'); const o = state.orders.find(o => o.id === orderId)!; const task = o.route.find(t => t.id === taskId && t.executorKind === 'employee' && t.employeeId !== null)!; return <form onSubmit={event => { const form = new FormData(event.currentTarget); void submitSimple(event, { type: 'work.submit', orderId, taskId, qty: number(form, 'qty'), note: text(form, 'note') }); }}><div className="form-body"><h3>{o.number} · {task.name}</h3><p>{employeeName(task.employeeId!)}</p><Field label={`Tayyor natija miqdori, ${unitLabel(taskUnit(state, task))}`}><input name="qty" type="number" min="0.001" max={task.planned - task.completed} step="0.001" defaultValue={task.planned - task.completed} required /></Field><Field label="Izoh"><input name="note" maxLength={500} /></Field><div className="info-note">{state.operations.find(row => row.id === task.operationId)?.autoAccept ? 'Natija topshirilgan zahoti qabul qilinadi.' : 'Natijani egasi tekshirib qabul qiladi.'}</div></div>{footer}</form>; })()}
      {modal.type === 'receive' && (() => { const p = state.purchases.find(p => p.id === modal.id)!; return <form onSubmit={event => { const form = new FormData(event.currentTarget); void submitSimple(event, { type: 'purchase.receive', purchaseId: p.id, lines: p.lines.filter(l => number(form, l.id) > 0).map(l => ({ lineId: l.id, qty: number(form, l.id) })) }); }}><div className="form-body"><p>{p.number} · Yetkazib berishning bir qismini qabul qilish mumkin</p>{p.lines.filter(l => l.received < l.qty).map(l => <Field key={l.id} label={`${state.items.find(i => i.id === l.itemId)?.name} · qoldi ${num(l.qty - l.received)}`}><input name={l.id} type="number" min="0" max={l.qty - l.received} step="0.001" defaultValue={l.qty - l.received} /></Field>)}<div className="info-note">Qabul zaxirani va yetkazib beruvchiga qarzni oshiradi. Alohida to‘lovgacha pul hisobdan chiqarilmaydi.</div></div>{footer}</form>; })()}
      {modal.type === 'cancelOrder' && <form onSubmit={event => void submitSimple(event, { type: 'order.cancel', orderId: modal.id! })}><div className="form-body"><div className="warning">Bekor qilishda berilgan materiallar omborga qaytadi, qabul qilingan ishlar tarixda qoladi, hisobotlar saqlanadi. Kiritilgan pul mijoz hisobida avans bo‘lib qoladi. Yuborilgan yoki tayyor mahsuloti omborga kirgan buyurtmani bekor qilib bo‘lmaydi.</div></div>{footer}</form>}
      {modal.type === 'reset' && <div className="form-body"><div className="warning">Faqat yangi namoyishning lokal ma’lumotlari o‘chiriladi. Eski HTML va Supabase ga tegilmaydi. Avval eksportni saqlang.</div><div className="button-group"><button className="secondary" onClick={() => exportData(state)}>Eksport</button><button className="danger-button" disabled={busy} onClick={() => { setBusy(true); void freshDemo().then(next => { setState(next); setModal(null); setSelectedOrder(null); }).catch(e => setNotice({ message: errorText(e), error: true })).finally(() => setBusy(false)); }}>Demo ma’lumotlarini tozalashni tasdiqlayman</button></div></div>}
    </Dialog>}
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleAlert size={19} /> : <Check size={19} />}<span>{notice.message}</span><button className="icon-button" aria-label="Xabarni yopish" onClick={() => setNotice(null)}><X size={15} /></button></div>}
  </>;
}

function modalTitle(type: string) { return ({ sync: 'Oflayn / onlayn — sinxronizatsiya', customer: 'Yangi mijoz', supplier: 'Yangi yetkazib beruvchi', employee: 'Yangi xodim', item: 'Katalogga material', stockSale: 'Ombordan do‘konga yuborish', orderPay: 'Mijoz to‘lovini qabul qilish', supplierPay: 'Yetkazib beruvchiga to‘lov', outsourcePay: 'Pudratchiga to‘lov', payrollPay: 'Xodimga to‘lov', salaryPlan: 'Oylik belgilash', salaryPay: 'Xodimga oylik yoki avans', salaryDeduct: 'Oylikdan ushlab qolish', salaryDeductReverse: 'Ushlab qolishni bekor qilish', expensePlan: 'Oylik xarajat', expensePay: 'Oylik xarajat to‘lovi', loanSet: 'Zaym yoki investitsiya', loanDraw: 'Zaym mablag‘ini olish', loanRepay: 'Zaymni qaytarish', cash: 'Kassa provodkasi', reverse: 'Storno — tarixni o‘chirmasdan', count: 'Inventarizatsiya', customerReceive: 'Mijoz materiallarini qabul qilish', work: 'Ish natijasini topshirish', workReview: 'Natijani qabul qilish', receive: 'Materiallar qabuli', shipment: 'Yuborish / natijani topshirish', cancelOrder: 'Buyurtmani bekor qilish', reset: 'Lokal namoyishni tozalash' } as Record<string, string>)[type] || 'Amal'; }


function PurchaseEditor({ state, preset, close, save, busy }: { state: State; preset?: { itemId: string; warehouseId: string }; close: () => void; save: (command: Command) => Promise<void>; busy: boolean }) {
  const need = preset ? supplyNeeds(state).find(row => row.itemId === preset.itemId && row.warehouseId === preset.warehouseId) : undefined;
  const [lines, setLines] = useState([{ itemId: preset?.itemId ?? '', qty: need?.short ?? 1, price: need?.lastPurchasePrice ?? 0 }]);
  const [warehouseId, setWarehouseId] = useState(preset?.warehouseId ?? MAIN_WAREHOUSE_ID);
  const orderId = need?.orders[0]?.id ?? null;
  const lastSupplier = preset ? [...state.purchases].reverse().find(purchase => purchase.lines.some(line => line.itemId === preset.itemId))?.supplierId : undefined;
  return <Dialog title="Yetkazib beruvchiga buyurtma" subtitle="Kutilayotgan yetkazib berish. Qoldiq faqat qabuldan keyin paydo bo‘ladi." close={close} wide><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'purchase.create', supplierId: text(form, 'supplierId'), lines, warehouseId, orderId }); }}><div className="form-body">{need && <div className="info-note">Yetishmayotgan {num(need.short)} {need.unit} — {need.orders.map(order => order.number).join(', ')} buyurtmasi uchun. Miqdor va narx to‘ldirildi.</div>}<Field label="Yetkazib beruvchi"><select name="supplierId" defaultValue={lastSupplier ?? ''} required><option value="">Yetkazib beruvchini tanlang</option>{state.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><WarehouseSelect warehouses={state.warehouses} value={warehouseId} onChange={setWarehouseId} label="Qaysi omborga" />{lines.map((line, index) => <div className="editor-line purchase-editor" key={index}><select aria-label={`Xarid qilinadigan material ${index + 1}`} required value={line.itemId} onChange={e => setLines(lines.map((l, i) => i === index ? { ...l, itemId: e.target.value } : l))}><option value="">O‘z materiali</option>{state.items.filter(i => !i.customerId).map(i => <option key={i.id} value={i.id}>{i.name} · {i.unit}</option>)}</select><input aria-label={`Xarid miqdori ${index + 1}`} type="number" min="0.001" step="0.001" required value={line.qty} onChange={e => setLines(lines.map((l, i) => i === index ? { ...l, qty: Number(e.target.value) } : l))} /><input aria-label={`Xarid narxi ${index + 1}`} placeholder="Narx / dona, UZS" type="number" min="0.01" step="0.01" required value={line.price || ''} onChange={e => setLines(lines.map((l, i) => i === index ? { ...l, price: Number(e.target.value) } : l))} /><button className="icon-button" type="button" disabled={lines.length === 1} aria-label={`Xaridni olib tashlash ${index + 1}`} onClick={() => setLines(lines.filter((_, i) => i !== index))}><X size={17} /></button></div>)}<button type="button" className="secondary small" onClick={() => setLines([...lines, { itemId: '', qty: 1, price: 0 }])}><Plus size={14} />Material</button><div className="payment-due"><small>Yetkazib beruvchiga buyurtma summasi</small><strong>{money(lines.reduce((s, l) => s + l.qty * l.price, 0))}</strong></div></div><footer className="form-footer"><button className="secondary" type="button" onClick={close}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Xarid yaratish'}</button></footer></form></Dialog>;
}

function CashForm({ busy, close, save }: { busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  const [direction, setDirection] = useState<'in' | 'out' | 'transfer'>('in');
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'cash.post', direction, amount: number(form, 'amount'), account: account(form), toAccount: direction === 'transfer' ? account(form, 'toAccount') : null, category: text(form, 'category'), note: text(form, 'note') }); }}><div className="form-body"><div className="segmented">{(['in', 'out', 'transfer'] as const).map(d => <button key={d} type="button" className={direction === d ? 'selected' : ''} onClick={() => setDirection(d)}>{({ in: 'Kirim', out: 'Chiqim', transfer: 'O‘tkazma' })[d]}</button>)}</div><Amount /><AccountField />{direction === 'transfer' && <Field label="Qayerga o‘tkazish"><select name="toAccount"><option value="bank">Bank / karta</option><option value="cash">Naqd pul</option></select></Field>}<Field label="Kategoriya"><select name="category">{(direction === 'in' ? ['Boshlang‘ich qoldiq', 'Egasining mablag‘i', 'Boshqa tushum'] : direction === 'out' ? ['Ijara', 'Kommunal xizmatlar', 'Transport', 'Soliqlar', 'Boshqa xarajatlar'] : ['O‘tkazma']).map(c => <option key={c}>{c}</option>)}</select></Field><Field label="Maqsad / asos"><input name="note" required maxLength={500} /></Field><div className="info-note">Buyurtma to‘lovlari — CRMdan. Yetkazib beruvchilarga — ta’minotdan. Ish haqi — xodimlardan. Shunda qarz provodka bilan birga yopiladi.</div></div><footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'O‘tkazilmoqda…' : 'O‘tkazish'}</button></footer></form>;
}

function periodBounds(period: string): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (period === 'week') start.setDate(start.getDate() - 6);
  else if (period === 'month') start.setDate(1);
  else if (period === 'year') start.setMonth(0, 1);
  else if (period === 'all') start.setFullYear(2000, 0, 1);
  const iso = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return { from: iso(start), to: iso(end) };
}

function Reports({ state, period, setPeriod, part }: { state: State; period: string; setPeriod: (period: string) => void; part: 'finance' | 'health' }) {
  const range = periodBounds(period);
  const report = periodReport(state, range.from, range.to);
  const shops = state.customers.filter(c => c.kind === 'shop').map(shop => shopReport(state, shop.id, range.from, range.to));
  const stock = stockBalanceReport(state, range.from, range.to);
  const machines = machineReport(state, range.from, range.to);
  const income = report.cashIn;
  const expenses = report.cashOut;
  const revenue = report.revenue;
  const cost = report.cogs;
  const operating = report.operating;
  const profit = report.profit;
  const employeeStats = state.employees.map(emp => { const entries = state.payroll.filter(p => p.employeeId === emp.id && withinPeriod(p.createdAt, range.from, range.to)); return { employee: emp, amount: entries.reduce((s, p) => s + p.amount, 0), accepted: acceptedWorkQty(state, emp.id, range.from, range.to) }; });
  const max = Math.max(revenue, cost, operating, Math.abs(profit), 1);
  const reportRows = [ ['Olingan pul', income], ['To‘langan pul', expenses], ['Kassa qoldig‘i', income - expenses], ['Yuborishlar bo‘yicha tushum', revenue], ['Yuborilganning to‘g‘ridan-to‘g‘ri xarajatlari', cost], ['Umumiy xarajatlar', operating], ['Boshqaruv foydasi', profit] ] as const;
  const downloadReport = () => { const csv = '\uFEFFKo‘rsatkich;UZS\n' + reportRows.map(([label, value]) => `${label};${value.toFixed(2).replace('.', ',')}`).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `aliya-report-${period}.csv`; a.click(); URL.revokeObjectURL(a.href); };
  return <><Title eyebrow={part === 'health' ? 'ANALITIKA / XODIMLAR' : 'ANALITIKA / BOSHQARUV HISOBOTLARI'} title={part === 'health' ? 'Ish natijasi va sog‘liq.' : 'Biznesni tushuntiradigan raqamlar.'} description={part === 'health' ? 'Qabul qilingan birliklar, bosqich tannarxi va ish muhiti — tanlangan davr uchun.' : 'Kassa oqimi foydadan alohida. Zaxira xaridi tannarxga qayta hisobdan chiqarilmaydi.'} action={part === 'finance' ? <button className="secondary" onClick={downloadReport}><Download size={16} />CSV eksporti</button> : undefined} /><div className="period-bar">{[['day', 'Bugun'], ['week', '7 kun'], ['month', 'Oy'], ['year', 'Yil'], ['all', 'Butun davr']].map(([key, name]) => <button className={period === key ? 'selected' : ''} key={key} onClick={() => setPeriod(key)}>{name}</button>)}</div>{part === 'finance' && <><div className="metrics"><Metric label="Yuborishlar bo‘yicha tushum" value={money(revenue)} detail="Yuborishda tan olinadi, to‘lovda emas" icon={Truck} /><Metric label="To‘g‘ridan-to‘g‘ri xarajatlar" value={money(cost)} detail="Yuborilganning materiallari va qabul qilingan ishi" icon={Factory} /><Metric label="Foyda, boshqaruv" value={money(profit)} detail="Tushum − to‘g‘ridan-to‘g‘ri va umumiy xarajatlar" icon={BarChart3} accent /><Metric label="Kassa qoldig‘i" value={money(income - expenses)} detail="Kirim − chiqim, o‘tkazmalarsiz" icon={Wallet} /></div><div className="dashboard-grid"><Section title="Natija tuzilishi" hint="Barcha ko‘rsatkichlar valyutasi — UZS"><div className="financial-bars">{[{ title: 'Tushum', value: revenue, class: 'green' }, { title: 'To‘g‘ridan-to‘g‘ri xarajatlar', value: cost, class: 'amber' }, { title: 'Umumiy xarajatlar', value: operating, class: 'coral' }, { title: 'Foyda', value: profit, class: 'blue' }].map(r => <div key={r.title}><div><span>{r.title}</span><b>{money(r.value)}</b></div><div className="bar-track"><i className={r.class} style={{ width: `${Math.abs(r.value) / max * 100}%` }} /></div></div>)}</div></Section><Section title="Haqiqiy pul harakati"><div className="settings-facts">{reportRows.slice(0, 3).map(([name, value]) => <span key={name}>{name}<b>{money(value)}</b></span>)}<span>Hozirgi naqd<b>{money(cashBalance(state, 'cash'))}</b></span><span>Hozirgi bank<b>{money(cashBalance(state, 'bank'))}</b></span><span>Mijozlar qarzi<b>{money(report.debt)}</b></span><span>Mijozlar avanslari<b>{money(report.advances)}</b></span></div></Section></div><FinanceReports report={report} shops={shops} stock={stock} machines={machines} /></>}{part === 'health' && <><Section title="Xodimlar ishlab chiqarishi" hint="Tanlangan davr uchun qabul qilingan natijalar, bosqich tannarxi va oylik qoldig‘i"><div className="table-scroll cardable"><table><thead><tr><th>Xodim</th><th className="right">Qabul qilingan birliklar</th><th className="right">Bosqich tannarxi</th><th className="right">Oylik qoldig‘i</th></tr></thead><tbody>{employeeStats.map(s => <tr key={s.employee.id}><td data-label="Xodim">{s.employee.name}</td><td data-label="Qabul qilingan birliklar" className="right">{num(s.accepted)}</td><td data-label="Bosqich tannarxi" className="right">{money(s.amount)}</td><td data-label="Oylik qoldig‘i" className="right">{money(payrollDebt(state, s.employee.id))}</td></tr>)}</tbody></table></div></Section><HealthSection state={state} /><div className="info-note"><Activity size={19} />Bu boshqaruv hisobotlari, rasmiy buxgalteriya yoki soliq hisoboti emas. Prognozlar va GPS kuzatuvi hali amalga oshirilmagan; ma’lumotlar o‘ylab topilmaydi.</div></>}</>;
}

function SalaryPlanForm({ state, employeeId, busy, close, save }: { state: State; employeeId: string; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  const employee = state.employees.find(row => row.id === employeeId);
  const versions = state.salaryPlans.filter(row => row.employeeId === employeeId).slice().sort((a, b) => b.fromMonth.localeCompare(a.fromMonth));
  const [fromMonth, setFromMonth] = useState(new Date().toISOString().slice(0, 7));
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'salary.plan.set', employeeId, amount: number(form, 'amount'), fromMonth }); }}>
    <div className="form-body">
      <div className="payment-due"><small>{employee?.name}</small><strong>Oylik belgilash</strong></div>
      <Field label="Oy boshlanadi (YYYY-MM)"><input name="fromMonth" value={fromMonth} onChange={event => setFromMonth(event.target.value)} pattern="\d{4}-\d{2}" inputMode="numeric" required maxLength={7} autoFocus /></Field>
      <Amount label="Oylik, UZS" name="amount" />
      <p className="subtle-note">Bu oydan boshlab har oyga shu summa yoziladi. Qabul qilingan ish hajmi oylikka qo‘shilmaydi. Bir oyga ikkinchi qiymat kiritilsa, eskisi almashtiriladi.</p>
      {!!versions.length && <div className="series-facts">{versions.map(row => <span key={row.id}>{row.fromMonth}<b>{money(row.amount)}</b><small>{dateTime(row.createdAt)}</small></span>)}</div>}
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button></footer>
  </form>;
}

export function SalaryPayForm({ employeeId, owed, busy, close, save }: { employeeId: string; owed: number; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  const [kind, setKind] = useState<'payroll' | 'advance'>('advance');
  const [allowPrepay, setAllowPrepay] = useState(false);
  const payable = Math.max(0, owed);
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'salary.pay', employeeId, amount: number(form, 'amount'), account: account(form), kind, note: text(form, 'note'), allowPrepay }); }}>
    <div className="form-body">
      <div className="payment-due"><small>Qoldiq</small><strong>{money(payable)}</strong></div>
      <div className="segmented">
        {(['advance', 'payroll'] as const).map(option => <button key={option} type="button" className={kind === option ? 'selected' : ''} onClick={() => setKind(option)}>{option === 'advance' ? 'Avans berish' : 'To‘liq to‘lov'}</button>)}
      </div>
      <Amount name="amount" defaultValue={payable || undefined} max={allowPrepay || payable <= 0 ? undefined : payable} />
      <AccountField />
      <Field label="Izoh"><input name="note" maxLength={200} /></Field>
      <label className="check-field"><input type="checkbox" checked={allowPrepay} onChange={event => setAllowPrepay(event.target.checked)} />Oldindan to‘lovga ruxsat</label>
      <p className="subtle-note">Ruxsat berilsa, ortiqcha summa keyingi oyga yoziladi. Naqd yoki bankdagi puldan oshib bo‘lmaydi.</p>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'To‘lovni o‘tkazish'}</button></footer>
  </form>;
}

export function OutsourceStageActions({ task, orderStatus, busy, onAccept, onPay }: {
  task: RouteLine; orderStatus: Status; busy: boolean; onAccept: () => void; onPay: () => void;
}) {
  const priced = supplierStagePriced(task);
  return <div className="button-group">
    <button className="secondary" disabled={busy || task.status === 'completed' || orderStatus === 'cancelled' || !priced} title={priced ? undefined : 'Avval pudratchi summasini kiriting'} onClick={onAccept}>Ishni qabul qilish</button>
    <button className="secondary" disabled={busy || orderStatus === 'cancelled'} onClick={onPay}>Pudratchiga to‘lash</button>
  </div>;
}

export function SupplierPayForm({ supplierId, orderId, category, defaultNote, balance, suggested, busy, close, save }: {
  supplierId: string; orderId: string | null; category: 'supplier' | 'outsourcing'; defaultNote: string;
  balance: number; suggested?: number; busy: boolean; close: () => void; save: (command: Command) => Promise<void>;
}) {
  const [allowPrepay, setAllowPrepay] = useState(false);
  const payable = Math.max(0, balance);
  const initial = payable > 0 ? Math.min(payable, suggested ?? payable) : 0;
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({
    type: 'supplier.pay', supplierId, ...(orderId ? { orderId } : {}), amount: number(form, 'amount'),
    account: account(form), allowPrepay, note: text(form, 'note'), category,
  }); }}>
    <div className="form-body">
      <div className="payment-due"><small>{balance >= 0 ? 'Qarz' : 'Avans'}</small><strong>{money(Math.abs(balance))}</strong></div>
      <Amount name="amount" defaultValue={initial || undefined} max={allowPrepay || payable <= 0 ? undefined : payable} />
      <AccountField />
      <Field label="Izoh"><input name="note" maxLength={200} defaultValue={defaultNote} required /></Field>
      <label className="check-field"><input type="checkbox" checked={allowPrepay} onChange={event => setAllowPrepay(event.target.checked)} />Avans to‘loviga ruxsat</label>
      <p className="subtle-note">{category === 'outsourcing'
        ? 'Qabul qilinmagan ish uchun to‘lov avans bo‘lib qoladi. Ruxsat berilsa, qarzdan ortiqcha summa ham yoziladi.'
        : 'Ruxsat berilsa, qabul qilingan xariddan ortiqcha summa avans bo‘lib qoladi.'}</p>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'To‘lovni o‘tkazish'}</button></footer>
  </form>;
}

export function SalaryDeductForm({ state, employeeId, busy, close, save }: { state: State; employeeId: string; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  const employee = state.employees.find(row => row.id === employeeId);
  const customer = state.customers.find(row => row.employeeId === employeeId);
  const debt = customer ? customerLedger(state, customer.id).debt : 0;
  const owed = payrollDebt(state, employeeId);
  const payable = Math.min(debt, owed);
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'salary.deduct', employeeId, amount: number(form, 'amount'), note: text(form, 'note') }); }}>
    <div className="form-body">
      <div className="payment-due"><small>Ushlash mumkin</small><strong>{money(payable)}</strong></div>
      <div className="settings-facts">
        <span>Xodim<b>{employee?.name}</b></span>
        <span>Mijoz hisobi<b>{customer?.name ?? '—'}</b></span>
        <span>Mijoz qarzi<b>{money(debt)}</b></span>
        <span>Oylik qoldig‘i<b>{money(owed)}</b></span>
      </div>
      <Amount name="amount" defaultValue={payable || undefined} max={payable || undefined} />
      <Field label="Izoh"><input name="note" maxLength={200} autoFocus /></Field>
      <p className="subtle-note">Summa naqd pulsiz: mijoz qarzi va oylik qarzi bir vaqtda kamayadi. Kassa o‘zgarmaydi.</p>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy || payable <= 0}>{busy ? 'Saqlanmoqda…' : 'Ushlab qolish'}</button></footer>
  </form>;
}

function ExpensePlanForm({ state, planId, busy, close, save }: { state: State; planId: string | null; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  const versions = planId ? state.expensePlans.filter(row => row.planId === planId).slice().sort((a, b) => b.fromMonth.localeCompare(a.fromMonth)) : [];
  const [fromMonth, setFromMonth] = useState(new Date().toISOString().slice(0, 7));
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'expense.plan.set', planId, title: text(form, 'title'), amount: number(form, 'amount'), fromMonth, dueDay: number(form, 'dueDay'), supplierId: text(form, 'supplierId') || null }); }}>
    <div className="form-body">
      <div className="payment-due"><small>{planId ? 'Tahrirlash' : 'Yangi xarajat'}</small><strong>Oylik xarajat</strong></div>
      <Field label="Nomi"><input name="title" maxLength={120} required autoFocus /></Field>
      <Field label="Oy boshlanadi (YYYY-MM)"><input name="fromMonth" value={fromMonth} onChange={event => setFromMonth(event.target.value)} pattern="\d{4}-\d{2}" inputMode="numeric" required maxLength={7} /></Field>
      <Field label="To‘lash kuni (1–31)"><input name="dueDay" type="number" min={1} max={31} step={1} defaultValue={10} required /></Field>
      <Amount label="Oylik summa, UZS" name="amount" />
      <Field label="Yetkazib beruvchi"><select name="supplierId" defaultValue=""><option value="">— yo‘q —</option>{state.suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field>
      <p className="subtle-note">Bu oydan boshlab har oyga shu summa yoziladi. Bir oyga ikkinchi qiymat kiritilsa, eskisi almashtiriladi.</p>
      {!!versions.length && <div className="series-facts">{versions.map(row => <span key={row.id}>{row.fromMonth}<b>{money(row.amount)}</b><small>{dateTime(row.createdAt)}</small></span>)}</div>}
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button></footer>
  </form>;
}

function ExpensePayForm({ planId, owed, busy, close, save }: { planId: string; owed: number; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  const [allowPrepay, setAllowPrepay] = useState(false);
  const payable = Math.max(0, owed);
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'expense.pay', planId, amount: number(form, 'amount'), account: account(form), note: text(form, 'note'), allowPrepay }); }}>
    <div className="form-body">
      <div className="payment-due"><small>Qoldiq</small><strong>{money(payable)}</strong></div>
      <Amount name="amount" defaultValue={payable || undefined} max={allowPrepay || payable <= 0 ? undefined : payable} />
      <AccountField />
      <Field label="Izoh"><input name="note" maxLength={200} /></Field>
      <label className="check-field"><input type="checkbox" checked={allowPrepay} onChange={event => setAllowPrepay(event.target.checked)} />Oldindan to‘lovga ruxsat</label>
      <p className="subtle-note">Ruxsat berilsa, ortiqcha summa keyingi oyga yoziladi. Naqd yoki bankdagi puldan oshib bo‘lmaydi.</p>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'To‘lovni o‘tkazish'}</button></footer>
  </form>;
}

function LoanSetForm({ state, loanId, busy, close, save }: { state: State; loanId: string | null; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  const loan = loanId ? state.loans.find(row => row.id === loanId) : null;
  const [kind, setKind] = useState<'loan' | 'investment'>(loan?.kind ?? 'loan');
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'loan.set', loanId, title: text(form, 'title'), kind, amount: number(form, 'amount'), note: text(form, 'note') }); }}>
    <div className="form-body">
      <div className="payment-due"><small>{loanId ? 'Tahrirlash' : 'Yangi yozuv'}</small><strong>{loanId ? 'Zaymni tahrirlash' : 'Zaym yoki investitsiya'}</strong></div>
      <Field label="Nomi"><input name="title" maxLength={200} required autoFocus defaultValue={loan?.title} /></Field>
      <div className="segmented">
        {(['loan', 'investment'] as const).map(option => <button key={option} type="button" className={kind === option ? 'selected' : ''} onClick={() => setKind(option)}>{option === 'loan' ? 'Zaym' : 'Investitsiya'}</button>)}
      </div>
      <Amount name="amount" defaultValue={loan?.amount} />
      <Field label="Izoh"><input name="note" maxLength={200} defaultValue={loan?.note} /></Field>
      <p className="subtle-note">Summa — zaym yoki investitsiyaning to‘liq hajmi. Olingan va qaytarilgan pul alohida yoziladi.</p>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button></footer>
  </form>;
}

function LoanDrawForm({ loanId, available, busy, close, save }: { loanId: string; available: number; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'loan.draw', loanId, amount: number(form, 'amount'), account: account(form), note: text(form, 'note') }); }}>
    <div className="form-body">
      <div className="payment-due"><small>Olish mumkin</small><strong>{money(available)}</strong></div>
      <Amount name="amount" defaultValue={available || undefined} max={available || undefined} />
      <AccountField />
      <Field label="Izoh"><input name="note" maxLength={200} /></Field>
      <p className="subtle-note">Olingan summa tanlangan hisobga tushadi va zaymning olinishi sifatida yoziladi.</p>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Pul olish'}</button></footer>
  </form>;
}

function LoanRepayForm({ loanId, owed, busy, close, save }: { loanId: string; owed: number; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'loan.repay', loanId, amount: number(form, 'amount'), account: account(form), note: text(form, 'note') }); }}>
    <div className="form-body">
      <div className="payment-due"><small>Qarzdorlik</small><strong>{money(owed)}</strong></div>
      <Amount name="amount" defaultValue={owed || undefined} max={owed || undefined} />
      <AccountField />
      <Field label="Izoh"><input name="note" maxLength={200} /></Field>
      <p className="subtle-note">Qaytarilgan summa tanlangan hisobdan chiqadi va qarzdorlikni kamaytiradi.</p>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Qaytarish'}</button></footer>
  </form>;
}
